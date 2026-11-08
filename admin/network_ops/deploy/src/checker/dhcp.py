#!/usr/bin/python3
import ipaddress
import json
import os
import subprocess
import sys

if len(sys.argv) > 1 and sys.argv[1] in ("bound", "renew"):
    address = str(ipaddress.IPv4Address(os.environ["ip"]))
    mask = str(ipaddress.IPv4Address(os.environ.get("subnet", "255.255.255.0")))
    prefix = ipaddress.IPv4Network("0.0.0.0/" + mask).prefixlen
    interface = os.environ["interface"]
    if interface != "eth0":
        raise ValueError("Unexpected DHCP interface")
    subprocess.run(["ip", "addr", "flush", "dev", interface], check=True)
    subprocess.run(["ip", "addr", "add", f"{address}/{prefix}", "dev", interface], check=True)
    routers = [str(ipaddress.IPv4Address(x)) for x in os.environ.get("router", "").split()]
    if routers:
        subprocess.run(["ip", "route", "replace", "default", "via", routers[0]], check=True)
    dns = [str(ipaddress.IPv4Address(x)) for x in os.environ.get("dns", "").split()]
    with open(os.environ["LAB_DHCP_FILE"], "w", encoding="utf-8") as f:
        json.dump({"address": address, "dns": dns, "routers": routers}, f)
