class Recorder {
    tabId = -1;
    frameId = -1;
    lastEvent = null;
    #events = [];
    #started = false;
    start(frameId, tabId) {
      console.log("Recorder has started");
      this.#started = true;
      document.body.style.border='8px solid red';    
      this.addListeners();
      this.frameId = frameId;
      this.tabId = tabId;
      if(top !== self) {
          this.sendFrameId();
      } else {
          this.addMessageListener();
      }
    }
    isStarted() {
      return this.#started;
    }
    sendFrameId() {
        top.postMessage({frameId: this.frameId, messageType: "Burp Suite Navigation Recorder frameId"}, '*');
    }
    getAllAttributesForNode(node) {
        let attributes = {};
        for(let i=0;i<node.attributes.length;i++){
            attributes[node.attributes[i].nodeName] = node.attributes[i].nodeValue;
        }
        return attributes;
    }
    getAllDataAttributesForNode(node) {
        return JSON.stringify(node.dataset);
    }
    addMessageListener() {
        let that = this;
        window.addEventListener('message', function(e){
            let data = e.data;
            if(typeof data === 'object' && e.data.messageType === 'Burp Suite Navigation Recorder frameId') {
                let iframes = document.querySelectorAll('iframe');
                for(let iframe of iframes) {
                    if(iframe.contentWindow === e.source) {
                        chrome.runtime.sendMessage({messageType:'collectIframeInfo', frameId: e.data.frameId, iframeInfo: {
                                xPath: that.getXPath(iframe),
                                tagNodeIndex: that.getTagIndex(iframe),
                                attributes: that.getAllAttributesForNode(iframe),
                                dataAttributes: that.getAllDataAttributesForNode(iframe),
                                iframeIndex: that.getIframeIndex(iframe)
                            }
                        });
                        break;
                    }
                }
            }
        })
    }
    isPasteEvent(e) {
      return e.key === 'v' && (e.ctrlKey || e.metaKey);
    }
    collectEvents(config) {
      if(this.#events.length) {
        if(config && config.triggersNavigation) {
          this.#events[this.#events.length-1].triggersNavigation = true;
        }
        if(config && config.opensNewContext) {
          this.#events[this.#events.length-1].opensNewContext = true;
        }
        if(config && config.tabId) {
            this.#events[this.#events.length-1].createdTabId = config.tabId;
        } else if(config && config.windowId) {
            this.#events[this.#events.length-1].createdWindowId = config.windowId;
        }
        chrome.runtime.sendMessage({messageType:'collectEvents', isIframe: top!==self, events:this.filterEvents(this.#events)});
        this.#events = [];
      }
    }
    executeXPath(expression) {
      try {
          let it = document.evaluate(expression, document, function (prefix) {
              if (prefix === 'svg') {
                  return 'http://www.w3.org/2000/svg';
              } else {
                  return null;
              }
          }, XPathResult.ANY_TYPE, null);
          return it.iterateNext();
      } catch(e){console.error("Navigation Recorder error invalid xpath:" + e);}
      return;
    }
    filterEvents(events) {
      let filtered = [];
      let chunk = [];
      for(let i=0;i<events.length;i++) {
        let event = events[i];
        delete events[i].element;
        if(event.eventType === 'click' || event.eventType === 'typing' || event.eventType === 'scroll' || event.eventType === 'keyboard') {
          filtered = filtered.concat(chunk);
          filtered.push(event);
          chunk = [];
        } else {
          chunk.push(event);
        }
      }
      return filtered;
    }
    getNamespacePrefix(element) {
        if(element instanceof SVGElement) {
            return "svg:";
        }
        return "";
    }
    getTextFromAccessibleAttributes(element){
        let text = [];

        if(/^input$/i.test(element.tagName) && /^button|submit$/i.test(element.type)) {
            text.push(element.value);
        }

        let ariaLabel = element.getAttribute('aria-label');
        if(ariaLabel !== null) {
            text.push(ariaLabel);
        }

        let alt = element.getAttribute("alt");
        if(alt !== null) {
            text.push(alt);
        }

        let title = element.getAttribute("title");
        if(title !== null) {
            text.push(title);
        }
        return text;
    }
    formatAccessibleText(text){
        return text.join(' ').replace(/\s{2,}/g,' ').trim();
    }
    getAccessibleText(element) {
        let allowList = ['a','abbr','address','area','article','aside','b','bdi','bdo','blockquote','button','caption',
            'cite','code','col','colgroup','data','datalist','dd','del','details','dfn','dialog','div','dl',
            'dt','em','fieldset','figcaption','figure','footer','form','header','h1','h2','h3','h4','h5','h6',
            'i','image','img','input','ins','kbd','label','legend','li','main','mark','meter','nav','ol','optgroup',
            'option','output','p','picture','pre','progress','q','rp','rt','ruby','s','samp','section','select','slot',
            'small','span','strike','strong','sub','summary','sup','table','tbody','td','textarea','tfoot','th','thead',
            'time','tr','tt','u','ul','var'
        ];
        let text = [];
        if(typeof element.tagName === 'string' && element.tagName.toLowerCase() === 'svg') {
            let title = element.querySelector('title');
            if(title && title.textContent.length) {
                text.push(title.textContent);
            }
        }
        if(typeof element.tagName === 'string' && !allowList.includes(element.tagName.toLowerCase()) && !this.isCustomElement(element)) {
            return text;
        }
        if(element.nodeType === 1) {
            text = [...text, ...this.getTextFromAccessibleAttributes(element)];
        } else if(element.nodeType === 3){
            text.push(element.nodeValue);
        }
        let len = element.childNodes.length;
        for(let i=0;i<len;i++) {
            let node = element.childNodes[i];
            text = [...text,...this.getAccessibleText(node)];
        }
        return text;
    }
    isCustomElement(element) {
        return element.tagName.includes("-");
    }
    getAriaSelector(element) {
        let text = this.formatAccessibleText(this.getAccessibleText(element)), that = this;
        let elements = Array.from(document.querySelectorAll(element.tagName)).filter(element => {
            return that.formatAccessibleText(that.getAccessibleText(element)) === text;
        });
        if(text.length > 0 && elements.length) {
            return "aria/" + text;
        }
    }
    getXPath(element){
      let ele = element;
      let path = [];
      let result;
      while(ele) {
        let pos = 0;
        let sibling = ele.previousElementSibling; 
        while(sibling) { 
          if(sibling.nodeName === ele.nodeName) {
            pos++;
          }       
          sibling = sibling.previousElementSibling;
        }
        let exp = this.getNamespacePrefix(ele) + ele.nodeName.toLowerCase();
        if(pos > 0) {
          exp = exp + '['+(pos+1)+']';
        }
        if(ele !== document) {
          path.unshift(exp);
        }
        ele = ele.parentNode;
      }
      result =  '/' + path.join('/');
      if(this.executeXPath(result) === element) {
        return result;
      }
    }
    complete() {
      chrome.runtime.sendMessage({messageType:'complete'}); 
    }
    saveEvent(event) {    
      this.#events.push(event);
    }
    addListeners() {
      let that = this;
      document.addEventListener('contextmenu', this.intercept, true);
      document.addEventListener('paste', this.intercept, true);
      document.addEventListener('keydown', this.intercept, true);
      document.addEventListener('click', this.intercept, true);
      document.addEventListener('scroll', this.intercept, true);
      window.addEventListener('hashchange', this.intercept, true);
      if(top !== self) {
          window.addEventListener('blur', function(){
              that.collectEvents();
          }, true);
      }
      window.addEventListener('beforeunload', function(){
        that.collectEvents();
      }, true);
    }
    removeListeners() {
      document.removeEventListener('contextmenu', this.intercept, true);              
      document.removeEventListener('paste', this.intercept, true);
      document.removeEventListener('keydown', this.intercept, true);
      document.removeEventListener('click', this.intercept, true);
      document.removeEventListener('scroll', this.intercept, true); 
      window.removeEventListener('hashchange', this.intercept, true);    
    }
    finish() {
      this.collectEvents();
      this.complete();
      this.stop();
    }
    stop() {
      if(this.#started) {
        this.#started = false;
        document.body.style.border="none"; 
        this.removeListeners();    
      }
    }
    captureChange(element) {
      element.addEventListener('change', function f(e){
        recorder.createClickEvent(e);
        element.removeEventListener('change', f, true);
      }, true);
    }
    intercept(e) {
        let recorder = window.recorder; 
        if(e.type === 'click') {
          let closestAnchor = e.target.closest("a,button");
          if(closestAnchor) {
              recorder.createClickEvent(e, closestAnchor);
              return;
          }
          let lastEvent = recorder.getLastEvent();    
          if(lastEvent && lastEvent.eventType === 'keyboard' && lastEvent.key === 'Enter' && e.target && e.target.form && !lastEvent.causesFormSubmission) {
            lastEvent.causesFormSubmission = true;
            return;//don't create click events when pressing the return key
          }   
          recorder.createClickEvent(e);
          if(e.target instanceof HTMLSelectElement) {
            recorder.captureChange(e.target);
          }
          recorder.lastEvent = e;
        } else if(e.type === 'hashchange') {        
          let lastEvent = recorder.getLastEvent();           
          if(lastEvent) {
            lastEvent.triggersWithinDocumentNavigation = true;
          }
        } else if(e.type === 'scroll') {
          recorder.createScrollEvent(e);
        } else if(e.type === 'contextmenu') {
          recorder.createClickEvent(e);
        } else if(e.type === 'paste') {
          let text = e.clipboardData.getData('text/plain');
          if(typeof text === 'string' && text.length) {
            recorder.createTypingEvent(e, text);
          }
        } else if (e.type === 'keydown') {
          if(e.key.length === 1 && !recorder.isPasteEvent(e)) {
            recorder.createTypingEvent(e, e.key);
          } else {
            //https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values
            switch(e.key) {
              //Modifier keys
              //The Alt key is intentially omitted. Since the typing event consoldates all character key presses.
              //case "Alt":
              case "AltGraph":
              //The Capslock key is intentially omitted. Since the typing event consoldates all character key presses.
              //case "CapsLock":
              //We don't want to interfere with copy/paste actions
              //case "Control":
              //case "Meta":
              case "Fn":
              case "FnLock":
              case "Hyper":
              case "NumLock":
              case "ScrollLock":
              //The shift key is intentially omitted. Since the typing event consoldates all character key presses.
              //case "Shift":
              case "Super":
              case "Symbol":
              case "SymbolLock":
              //whitespace keys
              case "Tab":
              case "Enter":          
              //navigation keys
              case "ArrowDown":
              case "ArrowLeft":
              case "ArrowRight":
              case "ArrowUp":
              case "End":
              case "Home":
              case "PageDown":
              case "PageUp":
              //editing keys
              case "Backspace":
              case "Clear":
              case "Copy":
              case "CrSel":
              case "Cut":
              case "Delete":
              case "EraseEof":
              case "ExSel":
              case "Insert":
              case "Paste":
              case "Redo":
              case "Undo":
              case "Accept":
              case "Again":
              case "Attn":
              case "Cancel":
              case "ContextMenu":
              case "Escape":
              case "Execute":
              case "Find":
              case "Finish":
              case "Help":
              case "Pause":
              case "Play":
              case "Props":
              case "Select":
              case "ZoomIn":
              case "ZoomOut":
              //device keys
              case "BrightnessDown":
              case "BrightnessUp":
              case "Eject":
              case "LogOff":
              case "Power":
              case "PowerOff":
              case "PrintScreen":
              case "Hibernate":
              case "Standby":
              case "WakeUp":
                recorder.createKeyboardEvent(e);
              break;
            }
          }
        } 
    }
    createScrollEvent(e) {
        let lastEvent = this.getLastEvent();
        let date = new Date();      
        if(lastEvent && lastEvent.eventType === 'scroll') {
           lastEvent.scrollX = window.scrollX;
           lastEvent.scrollY = window.scrollY;
        } else {         
          let scrollEvent = {
            date: date,
            timestamp: +date,                                            
            eventType: 'scroll',
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight       
          };
          this.saveEvent(scrollEvent);
        }
    }
    createTypingEvent(e, text) {
        let lastEvent = this.getLastEvent();
        if(lastEvent && lastEvent.eventType === 'typing') {
          lastEvent.typedValue += text;
        } else {        
          let typingEvent = this.createEvent(e.target, 'typing');
          typingEvent.typedValue = text;
          this.saveEvent(typingEvent);
        }
    }
    createEvent(element, type) {
      let uniqueTagID;
      let date = new Date;
      if(recorder.hasUniqueTagID(element)) {
        uniqueTagID = recorder.getUniqueTagID(element);
      } else {
        uniqueTagID = recorder.generateUniqueTagID(element);
      }
      let event = {
        date: date,
        timestamp: +date,
        windowInnerWidth: window.innerWidth,
        windowInnerHeight: window.innerHeight,
        uniqueElementID: uniqueTagID,
        tagName: element.tagName, 
        eventType: type,                     
        placeholder: element.placeholder,                          
        tagNodeIndex: recorder.getTagIndex(element),
        href: this.getAttributeValue(element, 'href'),
        src: this.getAttributeValue(element, 'src'),
        className: element.className,
        name: element.name, 
        id: element.id,
        frameId: this.frameId,
        tabId: this.tabId,
        textContent: element?.textContent?.slice(0,100), 
        innerHTML: element?.innerHTML?.slice(0,100), 
        text: element && element.form && element.tagName === 'SELECT' ? element[element.selectedIndex].text : undefined,
        selectedIndex: element.selectedIndex,
        value: element.value,
        elementType: element.type,
        xPath: this.getXPath(element),
        ariaSelector: this.getAriaSelector(element),
        triggersNavigation: false,
        triggersWithinDocumentNavigation: false        
      };
      return event;
    }
    createKeyboardEvent(e) {
        let date = new Date();
        let keyboardEvent = {
          date: date,
          timestamp: +date,                                            
          eventType: 'keyboard', 
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          key: e.key, 
          charCode: e.charCode
        };
        this.saveEvent(keyboardEvent);
    }
    createClickEvent(e, otherTarget) {
        let lastEvent = this.getLastEvent();
        let clickEvent = this.createEvent(otherTarget ? otherTarget : e.target, e.type === 'contextmenu' ? 'rightClick' : 'click');
        clickEvent.characterPos = e.target.selectionStart;
        clickEvent.shiftKey = e.shiftKey;
        clickEvent.ctrlKey = e.ctrlKey;
        clickEvent.altKey = e.altKey;
        clickEvent.metaKey = e.metaKey;
        clickEvent.element = otherTarget ? otherTarget : e.target;
        if(lastEvent && typeof lastEvent.tagName === 'string' && lastEvent.tagName.toLowerCase() === 'label' && lastEvent.eventType === 'click') {
            let labelElement = lastEvent.element;
            if(clickEvent.element && labelElement && clickEvent.element.labels && clickEvent.element.labels.length && Array.from(clickEvent.element.labels).includes(labelElement)) {
                return;
            }
        }
        this.saveEvent(clickEvent);
    }
    getIframeIndex(element) {
        for(let i=0;i<window.length;i++) {
            if(window[i] === element.contentWindow) {
                return i;
            }
        }
        return -1;
    }
    getAttributeValue(element, attributeName) {
        if(!element.getAttribute) {
            return;
        }
        let value = element.getAttribute(attributeName);
        if(value === null) {
            return;
        }
        return value;
    }
    getTagIndex(element) {    
      let tags = document.querySelectorAll(element.tagName);
      for(let i=0;i<tags.length;i++) {
        if(element === tags[i]) {
          return i;
        }
      }
      return -1;
    }
    getLastEvent() {
      return this.#events[this.#events.length-1];
    }
    getUniqueTagID(element) {
      return element.PORTSWIGGER_UNQIUE_ID;
    }
    hasUniqueTagID(element) {
      return element && element.PORTSWIGGER_UNQIUE_ID;
    }
    generateUniqueTagID() {
        return Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
    }
}
window.recorder = new Recorder();