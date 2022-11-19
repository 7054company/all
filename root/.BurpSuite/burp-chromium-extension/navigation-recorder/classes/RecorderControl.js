export default class RecorderControl {
    incognitoWindowId = -1;
    incognitoTabId = -1;
    tabIdLookup = Object.create(null);
    #sequence = [];
    #recording = false;
    #lastRecording = "";
    #imagePath = chrome.runtime.getManifest().name === 'Burp Suite Navigation Recorder' ? '../images/' : '../navigation-recorder/images/';
    #windowIds = [];
    start() {
        console.log('Recording...');
        this.#sequence = [];
        this.#lastRecording = '';
        let that = this;
        chrome.extension.isAllowedIncognitoAccess(function (isAllowed){
          if(isAllowed) {
            chrome.windows.create({incognito: true, focused: true, state: 'maximized'}, function(win){                                                  
              that.incognitoWindowId = win.id;
              that.incognitoTabId = win.tabs[0].id;
              chrome.tabs.onCreated.addListener(that.tabCreatedListener.bind(that));
              chrome.windows.onCreated.addListener(that.windowCreatedListener.bind(that));
              chrome.windows.onRemoved.addListener(that.windowRemovedListener.bind(that));
              chrome.webNavigation.onDOMContentLoaded.addListener(that.tabListener.bind(that));
              chrome.browserAction.setIcon({path: that.#imagePath + 'WebApp-Recorder-recording-icon.png'});
              that.manualUrlListener = that.manualUrlListener.bind(that);
              chrome.webNavigation.onBeforeNavigate.addListener(that.manualUrlListener);
              chrome.webNavigation.onCommitted.addListener(that.manualUrlListener);
              that.tabIdLookup[that.incognitoTabId] = win.id;
              that.saveEvent({
                  name:"Burp Suite Navigation Recorder", version: '1.4.19', eventType: "start", platform: navigator.platform, iframes: [], windows: [{windowId: win.id}], tabs: [{tabId: that.incognitoTabId, windowId: win.id}]
              });
            }); 
          } 
        });                       
    }
    isRecording() {
      return this.#recording;
    }
    getLastRecording() {
      return this.#lastRecording;
    }
    setRecordingState(state) {
        this.#recording = state;
    }
    copyToClipboard(text) {
      let backgroundPage = chrome.extension.getBackgroundPage();
      let textarea = backgroundPage.document.createElement("textarea");
      textarea.value = text;
      backgroundPage.document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      backgroundPage.document.body.removeChild(textarea);
    }
    triggersNavigation(lastEvent) {
        return !!(lastEvent && lastEvent.eventType !== "start" && lastEvent.eventType !== "goto");
    }
    tabIdToWindowId(tabId) {
        return this.tabIdLookup[tabId];
    }
    manualUrlListener(details) { 
        if(/^https?:/.test(details.url)) {
            let date = new Date();
            let gotoEvent = {
                date: date,
                timestamp: +date,
                eventType: 'goto',
                url: details.url,
                triggersNavigation: true,
                frameId: details.frameId,
                tabId: details.tabId,
                windowId: this.tabIdToWindowId(details.tabId)
            };
            let lastEvent = this.lastEvent();
            if(details.transitionQualifiers && details.transitionQualifiers.includes('client_redirect')) {
                let clientSideRedirect = {
                    date: date,
                    timestamp: +date,
                    url: details.url,
                    eventType: 'clientSideRedirect',
                    frameId: details.frameId,
                    tabId: details.tabId,
                    windowId: this.tabIdToWindowId(details.tabId)
                };
                if(this.triggersNavigation(lastEvent)) {
                    lastEvent.triggersNavigation = true;
                }
                this.saveEvent(clientSideRedirect);
            } else if(this.triggersNavigation(lastEvent)) {
              lastEvent.triggersNavigation = true;
              let navigateEvent = {
                  date: date,
                  timestamp: +date,
                  eventType: 'userNavigate',
                  url: details.url,
                  frameId: details.frameId,
                  tabId: details.tabId,
                  windowId: this.tabIdToWindowId(details.tabId)
              };
              this.saveEvent(navigateEvent);
            }
            if(details.transitionQualifiers && details.transitionQualifiers.includes('from_address_bar') && lastEvent && lastEvent.eventType === 'goto') {
              gotoEvent.fromAddressBar = true;  
              gotoEvent.url = lastEvent.url;            
            } else {
              gotoEvent.fromAddressBar = false;
            }      
            if(!lastEvent) {                
              this.saveEvent(gotoEvent);                                
            } else {
              if(!(lastEvent.fromAddressBar && gotoEvent.fromAddressBar && gotoEvent.url === lastEvent.url)) {
                this.saveEvent(gotoEvent);
              } 
            }
        }
      }
      addInfoToFirstEvent(property, data, lookupPropertyName, lookupPropertyValue) {
          if(!this.#sequence[0][property].find(element => element[lookupPropertyName] === lookupPropertyValue)) {
              this.#sequence[0][property].push(data);
          }
      }
      tabCreatedListener(tab) {
        let that = this;
        if(!tab.incognito || !this.isRecording()) {
            return;
        }
        chrome.tabs.query({windowId: tab.windowId}, function(tabs){
        if(!tabs.length) {
          return;
        }
        that.addInfoToFirstEvent('tabs', {tabId: tab.id, windowId: tab.windowId, openerTabId: tab.openerTabId}, 'tabId', tab.id);
        that.tabIdLookup[tab.id] = tab.windowId;
        chrome.tabs.executeScript(
          tabs[0].id,
          {code: `recorder.collectEvents({triggersNavigation:true, opensNewContext:true, windowId: ${tab.windowId},tabId: ${tab.id}});`}, () => {
            if(chrome.runtime.lastError) {
              console.log("Failed to collect events. error:", chrome.runtime.lastError);
            }
          });
        });
      }
      collectIframeInfo(frameId, windowId, iframeInfo) {
        this.iframeCreated(windowId, frameId, iframeInfo);
      }
      iframeCreated(windowId, frameId, iframeInfo) {
        let firstEvent = this.#sequence[0];
        for(let i=0;i<firstEvent.iframes.length;i++) {
            if(firstEvent.iframes[i].frameId === frameId) {
                return;
            }
        }
        firstEvent.iframes.push({frameId: frameId, createdByWindowId: windowId, ...iframeInfo});
      }
      windowCreatedListener(win) {
          let that = this;
          if(!this.isRecording()) {
              return;
          }
          if(win.incognito && win.id !== this.incognitoWindowId) {
              this.#windowIds.push(win.id);
              chrome.tabs.query({windowId: win.id}, function(tabs){
                  that.tabIdLookup[tabs[0].id] = win.id;
              });

              let that = this;
              chrome.tabs.query({windowId: this.incognitoWindowId}, function(tabs){
              if(!tabs.length) {
                  return;
              }
              that.addInfoToFirstEvent('windows', {windowId: win.id, state: win.state}, 'windowId', win.id);
              chrome.tabs.executeScript(
                tabs[0].id,
                {code: `recorder.collectEvents({triggersNavigation:true, opensNewContext:true, windowId: ${+win.id}});`}, () => {
                  if(chrome.runtime.lastError) {
                    console.log("Failed to collect events. error:", chrome.runtime.lastError);
                  }
                });
            });                    
          }
      }
      findLastEvent(excludeTypeRegex, callback){
        let len = this.#sequence.length;
        if(len) {
          for(let i=len-1;i>0;i--) {
            if(this.#sequence[i] && !excludeTypeRegex.test(this.#sequence[i].eventType)) {
              callback(i, this.#sequence);
              return;
            }
          }
        }
      }
      windowRemovedListener(winId) {
        if(this.isRecording() && winId !== this.incognitoWindowId) {                    
          if(this.#sequence.length) {
            this.findLastEvent(/^(?:goto|userNavigate)$/, function(pos, obj){
               obj[pos].closesContext = true;
            });            
          }                            
        }
        if(this.isRecording() && winId === this.incognitoWindowId) {
          this.finish();
          chrome.storage.sync.set({recording: false, complete:true}, function() {
            console.log("Stopped recording");              
          });   
        }
      }
      tabListener(details) {
        if(this.isRecording()) {
          chrome.tabs.get(details.tabId, function(tab) {
              if(tab.incognito) {
                chrome.tabs.executeScript(details.tabId, {frameId:details.frameId, "runAt":"document_start","code": `window.recorder.start(${+details.frameId},${+details.tabId});`}, () => {
                  if(chrome.runtime.lastError) {
                    console.log("Failed to execute JavaScript", chrome.runtime.lastError);
                  }
                });           
              }
          });                   
        }      
      }
      lastEvent() {
        return this.#sequence[this.#sequence.length-1];
      }
      saveEvent(event) {
        this.#sequence.push(event);
      }
      addWindowTabInformation(events) {
        let firstEvent = this.#sequence[0];
        for(let i = 0; i < events.length;i++) {
            let event = events[i];
            if(event.createdTabId) {
               for(let j=0;j<firstEvent.tabs.length;j++) {
                   if(firstEvent.tabs[j].tabId === event.createdTabId && firstEvent.tabs[j].windowId === event.windowId && event.opensNewContext) {
                       firstEvent.tabs[j].createdByEvent = i;
                       break;
                   }
               }
            } else if(event.createdWindowId) {
                for(let j=0;j<firstEvent.windows.length;j++) {
                    if(firstEvent.windows[j].windowId === event.createdWindowId && firstEvent.windows[j].tabId === event.tabId && event.opensNewContext) {
                        firstEvent.windows[j].createdByEvent = i;
                        break;
                    }
                }
            }
        }
      }
      storeData(data) {
        this.#sequence = this.#sequence.concat(data);
      }
      installed() {
        console.log("Extension installed");
      }
      pageUnload() {
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if(!tabs.length) {
              return;
          }
            if(tabs[0]) {
                chrome.tabs.executeScript(
                    tabs[0].id,
                    {code: `recorder.collectEvents();`}, () => {
                      if(chrome.runtime.lastError) {
                        console.log("Failed to collect events. error:",chrome.runtime.lastError);
                      }
                    });
            } else {
              console.log("Unable to collect events tab doesn't exist");
            }
          });        
      }
      finish() {
        console.log('Stopped recording.');
        let that = this;
        chrome.tabs.query({windowId: this.incognitoWindowId}, function(tabs) {
          if(!tabs.length) {
            that.complete();
            return;
          }      
           chrome.tabs.executeScript(
              tabs[0].id,
              {code: `recorder.finish();`}, () => {
                   that.complete();
                    if(typeof chrome.runtime.lastError !== 'undefined') {
                        console.log("Error closing window", chrome.runtime.lastError);
                    }
              });
        });
        chrome.browserAction.setIcon({path: this.#imagePath + 'WebApp-Recorder-stop-icon.png'});
      }
      filterEvents(events) {
          let filtered = [];          
          for(let i=0;i<events.length;i++) {
            let event = events[i];
            let lastEvent = events[i-1];            
            if(event.eventType === 'goto') {
              if(!event.fromAddressBar) {
                continue;
              } else {
                if(lastEvent && lastEvent.eventType === 'goto') {              
                  let lastFiltered = filtered[filtered.length-1];
                  if(lastFiltered && lastFiltered.eventType !== 'start') {
                    filtered[filtered.length-1] = event;
                  } else {
                    filtered.push(event);
                  }
                } else {
                  filtered.push(event);
                }             
              }
            } else {              
              filtered.push(event);
            }
          }          
          return filtered;
      }
      complete() {  
        chrome.tabs.onCreated.removeListener(this.tabCreatedListener);
        chrome.windows.onCreated.removeListener(this.windowCreatedListener);
        chrome.windows.onRemoved.removeListener(this.windowRemovedListener);     
        chrome.webNavigation.onDOMContentLoaded.removeListener(this.tabListener); 
        chrome.webNavigation.onBeforeNavigate.removeListener(this.manualUrlListener);
        chrome.webNavigation.onCommitted.removeListener(this.manualUrlListener);
        let filteredEvents = this.filterEvents(this.#sequence);
        this.addWindowTabInformation(filteredEvents);
        if(this.#sequence.length) {
          try {             
            this.#lastRecording = JSON.stringify(filteredEvents, undefined, 4);
          } catch(e) {
            console.log("Failed to save JSON"+e);
          }    
        }
        this.#sequence = [];
        chrome.notifications.create("notify", {iconUrl: this.#imagePath + "WebApp-Recorder-128.png", title:"Burp Suite navigation recorder", type:"basic", message:"Your recording has finished and has been copied to your clipboard."});
        this.copyToClipboard(this.getLastRecording());
        this.#windowIds.forEach(windowId => {
            chrome.windows.remove(windowId, function(){
                if (chrome.runtime.lastError) {
                    console.log("Could not close window. Already closed.");
                }
            })
        });
        if(this.incognitoWindowId > 0) {
            let that = this;
            chrome.windows.remove(this.incognitoWindowId, function(){
              that.copyToClipboard(that.getLastRecording());
              if (chrome.runtime.lastError) {
              console.log("Could not close window. Already closed.");
            }
          });
        }
      }
}