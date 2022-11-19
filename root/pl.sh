#!/bin/sh

# Waiting for the execute rc.local script
# but wait the initial configuration only(network, passwords, etc.)
# do not wait the Plesk updates and install extensions
wait_for_init()
{
	for count in `seq 120`; do
		[ -f "/root/firstrun" ] || return 0
		sleep 1
	done

	return 1
}

set_logind_banner()
{
	# Writing login link into pre-login message
	cp -f /etc/issue /etc/issue.bak

	{
		echo ""
		echo "EC2 instance with Plesk was deployed"
		echo ""
		echo "`/sbin/plesk version 2>/dev/null || /usr/sbin/plesk version`"
		echo ""
		echo "Use the following one-time login link for accessing Plesk as an administrator:"
		echo ""
		echo "`/sbin/plesk login 2>/dev/null || /usr/sbin/plesk login`"
		echo ""
	} > /etc/issue
}

reset_logind_banner()
{
	# Rollback the typical pre-login message
	if [ -f "/etc/issue.bak" ]; then
		mv -f /etc/issue.bak /etc/issue
	fi
}

if [ -f "/root/firstlogin.flag" ]; then
	wait_for_init
	set_logind_banner
	rm -f "/root/firstlogin.flag"
	exit 0
fi

reset_logind_banner

exit 0
