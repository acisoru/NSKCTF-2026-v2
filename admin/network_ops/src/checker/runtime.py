import copy
import ipaddress
import json
import os
import pathlib
import pwd
import re
import shutil
import subprocess
import tempfile
import time
import uuid


def execute(args, timeout=4, check=True, env=None):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        if check:
            raise
        return subprocess.CompletedProcess(args, 124, '', 'Timeout: no network response')
    if check and result.returncode:
        raise RuntimeError(f"{args[0]}: {result.stderr.strip()[:240]}")
    return result


def start_ovs():
    pathlib.Path('/run/openvswitch').mkdir(parents=True, exist_ok=True)
    database = '/run/openvswitch/conf.db'
    execute(['ovsdb-tool', 'create', database, '/usr/share/openvswitch/vswitch.ovsschema'])
    execute(['ovsdb-server', database, '--remote=punix:/run/openvswitch/db.sock', '--pidfile=/run/openvswitch/ovsdb-server.pid', '--detach', '--no-chdir'])
    execute(['ovs-vsctl', '--no-wait', 'init'])
    execute(['ovs-vswitchd', '--pidfile=/run/openvswitch/ovs-vswitchd.pid', '--detach', '--no-chdir', '--log-file=/run/openvswitch/switch.log'])


def validate(data):
    if not isinstance(data, dict) or data.get('level') not in ['easy', 'medium', 'hard']:
        raise ValueError('Invalid level')
    if not isinstance(data.get('subnet'), int) or not 20 <= data['subnet'] <= 219:
        raise ValueError('Invalid subnet')
    if not re.fullmatch(r'[a-f0-9]{48}', data.get('nonce', '')):
        raise ValueError('Invalid job ID')
    expected = {'pc': ('host', ['eth0']), 'swa': ('switch', ['p1', 'p2', 'p3', 'p4']), 'archive': ('server', ['eth0'])}
    expected['r1'] = ('router', ['lan', 'srv'] if data['level'] == 'easy' else ['uplink', 'wan1', 'wan2'] if data['level'] == 'hard' else ['uplink'])
    if data['level'] != 'easy':
        expected.update({'swb': ('switch', ['p1', 'p2', 'p3', 'p4']), 'cam': ('camera', ['eth0'])})
    if data['level'] == 'hard':
        expected.update({'swc': ('switch', ['p1', 'p2', 'p3', 'p4']), 'r2': ('router', ['wan1', 'wan2', 'srv'])})
    devices = data.get('devices')
    if not isinstance(devices, list) or len(devices) != len(expected):
        raise ValueError('Invalid device set')
    if {d.get('id') for d in devices} != set(expected):
        raise ValueError('Invalid device ID')
    for d in devices:
        if (d.get('kind'), d.get('ports')) != expected[d['id']]:
            raise ValueError('Invalid device ports')
    ports = {f'{d}:{p}' for d, (_, ps) in expected.items() for p in ps}
    used = set()
    if not isinstance(data.get('links'), list) or len(data['links']) > 24:
        raise ValueError('Invalid links')
    for edge in data['links']:
        if not isinstance(edge, list) or len(edge) != 2 or edge[0] == edge[1] or any(p not in ports or p in used for p in edge):
            raise ValueError('Invalid link endpoint')
        used.update(edge)
    network = ipaddress.ip_network(f'10.{data["subnet"]}.0.0/16')
    for collection in ['configs', 'startup']:
        if set(data.get(collection, {})) != set(expected):
            raise ValueError('Invalid configuration set')
        for name, cfg in data[collection].items():
            allowed = set(expected[name][1]) | ({'uplink.10', 'uplink.20', 'uplink.30'} if name == 'r1' and data['level'] != 'easy' else set())
            if not isinstance(cfg, dict) or not isinstance(cfg.get('addresses'), dict) or len(cfg['addresses']) > 8:
                raise ValueError('Invalid addresses')
            for interface, address in cfg['addresses'].items():
                parsed = ipaddress.ip_interface(address)
                if interface not in allowed or parsed.version != 4 or parsed.ip not in network or not 8 <= parsed.network.prefixlen <= 30:
                    raise ValueError('Invalid interface address')
            for key in ['dns', 'gateway']:
                if cfg.get(key) is not None and ipaddress.ip_address(cfg[key]) not in network:
                    raise ValueError('Address outside lab')
            for key in ['dhcp', 'forwarding', 'ospf', 'rstp', 'denySsh']:
                if type(cfg.get(key)) is not bool:
                    raise ValueError('Invalid boolean')
            if type(cfg.get('priority')) is not int or cfg['priority'] not in range(0, 61441, 4096):
                raise ValueError('Invalid bridge priority')
            if set(cfg.get('ports', {})) != set(expected[name][1]):
                raise ValueError('Invalid switch configuration')
            for port in cfg['ports'].values():
                if port.get('mode') not in ['access', 'trunk'] or not isinstance(port.get('vlans'), list) or not 1 <= len(port['vlans']) <= 8 or any(type(v) is not int or not 1 <= v <= 4094 for v in port['vlans']):
                    raise ValueError('Invalid VLAN')
                if port['mode'] == 'access' and len(port['vlans']) != 1:
                    raise ValueError('Invalid access VLAN')
    if set(data.get('power', {})) != set(expected) or any(type(v) is not bool for v in data['power'].values()):
        raise ValueError('Invalid power state')
    if not isinstance(data.get('physical'), list) or {c.get('id') for c in data['physical']} != {'topology', 'power', 'crafted', 'wiremap', 'panel'}:
        raise ValueError('Invalid physical checks')
    if any(type(c.get('ok')) is not bool for c in data['physical']):
        raise ValueError('Invalid check value')
    diagnostic = data.get('diagnostic')
    if diagnostic:
        if not isinstance(diagnostic, dict) or diagnostic.get('device') not in expected or diagnostic.get('operation') not in ['ping', 'traceroute', 'routes', 'mac', 'stp', 'neighbors', 'addresses', 'interfaces', 'arp', 'dig', 'nslookup']:
            raise ValueError('Invalid diagnostic')
        if diagnostic['operation'] in ['ping', 'traceroute'] and diagnostic.get('target') != 'archive.lab' and ipaddress.ip_address(diagnostic.get('target')) not in network:
            raise ValueError('Invalid target')
        if 'count' in diagnostic and (type(diagnostic['count']) is not int or not 1 <= diagnostic['count'] <= 5):
            raise ValueError('Invalid packet count')
        interface = diagnostic.get('interface')
        allowed = set(expected[diagnostic['device']][1]) | ({'uplink.10', 'uplink.20', 'uplink.30'} if diagnostic['device'] == 'r1' and data['level'] != 'easy' else set())
        if interface is not None and interface not in allowed:
            raise ValueError('Invalid diagnostic interface')
        if diagnostic['operation'] in ['dig', 'nslookup']:
            name = diagnostic.get('target')
            if not isinstance(name, str) or len(name) > 253 or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+lab', name):
                raise ValueError('Invalid DNS name')
            if diagnostic.get('server') is not None and ipaddress.ip_address(diagnostic['server']) not in network:
                raise ValueError('Invalid DNS server')
            if diagnostic.get('record') not in ['A', 'AAAA', 'MX', 'TXT', 'NS', 'SOA'] or type(diagnostic.get('short')) is not bool:
                raise ValueError('Invalid DNS options')
    return data


class Network:
    def __init__(self, data):
        self.data = data
        self.prefix = 'nl' + uuid.uuid4().hex[:7]
        self.path = pathlib.Path(tempfile.mkdtemp(prefix=self.prefix))
        self.namespaces = {}
        self.bridges = {}
        self.processes = []
        self.links = []
        self.link_ports = {}
        self.address = f'10.{data["subnet"]}.{"30" if data["level"] == "medium" else "99"}.10'
        self.deadline = time.monotonic() + 90

    def ns(self, device, args, timeout=4, check=True, env=None):
        if time.monotonic() > self.deadline:
            raise RuntimeError('Lab deadline exceeded')
        return execute(['ip', 'netns', 'exec', self.namespaces[device], *args], timeout, check, env)

    def process(self, device, args, env=None):
        log = open(self.path / f'{device}-{len(self.processes)}.log', 'w', encoding='utf-8')
        child = subprocess.Popen(['ip', 'netns', 'exec', self.namespaces[device], *args], stdout=log, stderr=log, env=env, start_new_session=True)
        log.close()
        self.processes.append(child)
        return child

    def setup(self):
        data = self.data
        for device in data['devices']:
            name = device['id']
            if device['kind'] == 'switch':
                bridge = self.prefix + name
                self.bridges[name] = bridge
                execute(['ovs-vsctl', 'add-br', bridge, '--', 'set', 'Bridge', bridge, 'datapath_type=netdev', f'rstp_enable={str(data["configs"][name]["rstp"]).lower()}', f'other_config:rstp-priority={data["configs"][name]["priority"]}'])
                execute(['ip', 'link', 'set', bridge, 'up'])
            else:
                namespace = self.prefix + name
                execute(['ip', 'netns', 'add', namespace]); self.namespaces[name] = namespace
                self.ns(name, ['ip', 'link', 'set', 'lo', 'up'])
        for i, edge in enumerate(data['links']):
            pair = [self.prefix + f'{i}a', self.prefix + f'{i}b']
            execute(['ip', 'link', 'add', pair[0], 'type', 'veth', 'peer', 'name', pair[1]])
            self.links.extend(pair)
            # AF_PACKET userspace switching cannot preserve partial checksum metadata.
            for interface in pair:
                execute(['ethtool', '-K', interface, 'tx', 'off', 'rx', 'off', 'gro', 'off', 'gso', 'off', 'tso', 'off', 'rxvlan', 'off', 'txvlan', 'off'], check=False)
            for endpoint, interface in zip(edge, pair):
                device, port = endpoint.split(':'); self.link_ports[endpoint] = interface
                if device in self.bridges:
                    cfg = data['configs'][device]['ports'][port]
                    args = ['ovs-vsctl', 'add-port', self.bridges[device], interface, '--', 'set', 'Port', interface]
                    args += [f'tag={cfg["vlans"][0]}', 'vlan_mode=access'] if cfg['mode'] == 'access' else [f'trunks={",".join(map(str, cfg["vlans"]))}', 'vlan_mode=trunk']
                    peer = edge[1] if endpoint == edge[0] else edge[0]
                    if peer.split(':')[0] not in self.bridges:
                        args.append('other_config:rstp-port-admin-edge=true')
                    execute(args)
                    if data['power'][device]:
                        execute(['ip', 'link', 'set', interface, 'up'])
                else:
                    execute(['ip', 'link', 'set', interface, 'netns', self.namespaces[device]])
                    self.ns(device, ['ip', 'link', 'set', interface, 'name', port])
                    if data['power'][device]:
                        self.ns(device, ['ip', 'link', 'set', port, 'up'])
        for device in data['devices']:
            name = device['id']; cfg = data['configs'][name]
            if name not in self.namespaces:
                continue
            for port in device['ports']:
                if f'{name}:{port}' not in self.link_ports:
                    self.ns(name, ['ip', 'link', 'add', port, 'type', 'dummy'])
                    if data['power'][name]:
                        self.ns(name, ['ip', 'link', 'set', port, 'up'])
            for port, address in cfg['addresses'].items():
                if '.' in port:
                    parent, vlan = port.split('.')
                    self.ns(name, ['ip', 'link', 'add', 'link', parent, 'name', port, 'type', 'vlan', 'id', vlan])
                    if data['power'][name]:
                        self.ns(name, ['ip', 'link', 'set', port, 'up'])
                self.ns(name, ['ip', 'addr', 'add', address, 'dev', port], check=False)
            if cfg['gateway']:
                self.ns(name, ['ip', 'route', 'replace', 'default', 'via', cfg['gateway']], check=False)
            if device['kind'] == 'router':
                self.ns(name, ['sysctl', '-q', '-w', f'net.ipv4.ip_forward={int(cfg["forwarding"])}'])
                self.ns(name, ['sysctl', '-q', '-w', 'net.ipv4.conf.all.rp_filter=0'])
                if cfg['denySsh']:
                    policy = self.path / f'{name}.nft'
                    policy.write_text(f'table inet lab {{\n chain forward {{\n  type filter hook forward priority 0; policy accept;\n  ip saddr 10.{data["subnet"]}.20.0/24 ip daddr {self.address} tcp dport 22 reject\n }}\n}}\n')
                    self.ns(name, ['nft', '-f', str(policy)])
                if cfg['ospf'] and data['power'][name]:
                    self.start_ospf(name, cfg)
        if data['power']['archive']:
            self.process('archive', ['python', '/opt/checker/services.py'])
        self.start_dns()
        time.sleep(1.2)
        for name in ['pc', 'cam']:
            if name in self.namespaces and data['configs'][name]['dhcp'] and data['power'][name]:
                env = {**os.environ, 'LAB_DHCP_FILE': str(self.path / f'{name}-dhcp.json')}
                self.ns(name, ['busybox', 'udhcpc', '-i', 'eth0', '-n', '-q', '-t', '3', '-T', '1', '-s', '/opt/checker/dhcp.py'], timeout=6, check=False, env=env)

    def start_dns(self):
        data = self.data
        name = 'archive' if data['level'] == 'easy' else 'r1'
        if not data['power'][name]:
            return
        args = ['dnsmasq', '--keep-in-foreground', '--conf-file=/dev/null', '--no-resolv', '--bind-interfaces', '--no-hosts', '--no-ping', '--local=/lab/', '--log-facility=-', f'--address=/archive.lab/{self.address}', f'--pid-file={self.path}/{name}-dns.pid', f'--dhcp-leasefile={self.path}/{name}.leases', '--user=root']
        if data['level'] != 'easy':
            for subnet in [10, 20]:
                base = f'10.{data["subnet"]}.{subnet}'
                args.extend([f'--interface=uplink.{subnet}', f'--dhcp-range=set:v{subnet},{base}.20,{base}.60,255.255.255.0,1h', f'--dhcp-option=tag:v{subnet},option:router,{base}.1', f'--dhcp-option=tag:v{subnet},option:dns-server,{base}.1'])
        self.process(name, args)

    def start_ospf(self, name, cfg):
        directory = self.path / name; directory.mkdir()
        account = pwd.getpwnam('frr')
        os.chmod(self.path, 0o755); os.chown(directory, account.pw_uid, account.pw_gid)
        zebra = directory / 'zebra.conf'; zebra.write_text('hostname lab-router\nlog stdout\n')
        ospf = directory / 'ospfd.conf'
        lines = ['hostname lab-router', 'log stdout']
        for port in cfg['addresses']:
            if port.startswith('wan'):
                lines.extend([f'interface {port}', ' ip ospf network point-to-point', ' ip ospf hello-interval 1', ' ip ospf dead-interval 3', f' ip ospf cost {10 if port == "wan1" else 20}', '!'])
        lines.extend(['router ospf', f' ospf router-id {"1.1.1.1" if name == "r1" else "2.2.2.2"}', ' network 0.0.0.0/0 area 0', '!'])
        ospf.write_text('\n'.join(lines) + '\n')
        common = ['-u', 'frr', '-g', 'frr', '-z', str(directory / 'zebra.sock'), '--vty_socket', str(directory), '-P', '0']
        self.process(name, ['/usr/lib/frr/zebra', '-f', str(zebra), '-i', str(directory / 'zebra.pid'), *common])
        time.sleep(.2)
        self.process(name, ['/usr/lib/frr/ospfd', '-f', str(ospf), '-i', str(directory / 'ospfd.pid'), *common])

    def dhcp(self, name):
        path = self.path / f'{name}-dhcp.json'
        return json.loads(path.read_text()) if path.exists() else {}

    def lookup(self, device):
        cfg = self.data['configs'][device]
        dns = cfg['dns'] if not cfg['dhcp'] else next(iter(self.dhcp(device).get('dns', [])), None)
        if not dns:
            return []
        resolver = "import dns.resolver,json,sys;r=dns.resolver.Resolver(configure=False);r.nameservers=[sys.argv[1]];r.lifetime=3;r.timeout=1;print(json.dumps([a.address for a in r.resolve('archive.lab','A')]))"
        response = self.ns(device, ['python', '-c', resolver, dns], timeout=4, check=False)
        return json.loads(response.stdout) if response.returncode == 0 else []

    def http(self, name, attempts=1):
        for _ in range(attempts):
            if self.ns(name, ['curl', '-fsS', '--noproxy', '*', '--max-time', '1', f'http://{self.address}/'], timeout=2, check=False).stdout.strip() == 'LABX ARCHIVE ONLINE':
                return True
            time.sleep(.15)
        return False

    def ssh(self, name):
        script = "import socket,sys;s=socket.create_connection((sys.argv[1],22),1);print(s.recv(100).decode());s.close()"
        return self.ns(name, ['python', '-c', script, self.address], timeout=2, check=False).stdout.startswith('SSH-2.0-')

    def checks(self):
        data = self.data; checks = copy.deepcopy(data['physical'])
        def add(id, name, ok, detail=''):
            checks.append({'id': id, 'name': name, 'ok': bool(ok), 'detail': str(detail)[:400]})
        if data['level'] == 'hard':
            end = time.monotonic() + 9
            while time.monotonic() < end:
                if self.http('pc'):
                    break
                time.sleep(.5)
        addresses = json.loads(self.ns('pc', ['ip', '-j', '-4', 'addr', 'show', 'dev', 'eth0']).stdout)
        assigned = [a['local'] for link in addresses for a in link.get('addr_info', [])]
        valid_pc = any(ipaddress.ip_address(ip) in ipaddress.ip_network(f'10.{data["subnet"]}.10.0/24') for ip in assigned)
        add('pc-address', 'Рабочая станция / адресация', valid_pc and (data['level'] == 'easy' or bool(self.dhcp('pc'))), ', '.join(assigned) or 'Адрес не назначен')
        resolved = self.lookup('pc')
        add('dns', 'DNS / archive.lab', self.address in resolved, ', '.join(resolved) or 'Нет корректного DNS-ответа')
        add('http', 'Станция → архив / HTTP', self.http('pc', 3))
        if data['level'] != 'easy':
            lease = self.dhcp('cam').get('address')
            add('camera-dhcp', 'Регистратор / DHCP VLAN 20', bool(lease) and ipaddress.ip_address(lease) in ipaddress.ip_network(f'10.{data["subnet"]}.20.0/24'), lease or 'DHCP lease отсутствует')
            camera_http = self.http('cam'); add('camera-http', 'Регистратор → архив / HTTP', camera_http)
            add('camera-ssh-denied', 'Регистратор → управление / запрет TCP 22', camera_http and not self.ssh('cam'))
            add('admin-ssh', 'Станция → управление / TCP 22', self.ssh('pc'))
        if data['level'] == 'hard':
            status = execute(['ovs-appctl', 'rstp/show'], check=False).stdout
            add('rstp', 'RSTP / резервная L2-топология', all(data['configs'][name]['rstp'] for name in self.bridges) and bool(re.search(r'discarding|alternate', status, re.I)), status[-350:])
            route = self.ns('r1', ['ip', 'route', 'show', 'proto', 'ospf'], check=False).stdout
            # Linux route protocol 188 is FRR OSPF on some iproute2 versions.
            if not route:
                route = self.ns('r1', ['ip', 'route', 'show', 'proto', '188'], check=False).stdout
            add('ospf', 'OSPF / маршрут архива', f'10.{data["subnet"]}.99.0/24' in route, route)
            self.ns('r1', ['ip', 'link', 'set', 'wan1', 'down'])
            failover = False; end = time.monotonic() + 8
            while time.monotonic() < end:
                route = self.ns('r1', ['ip', 'route', 'get', self.address], check=False).stdout
                if 'wan2' in route and self.http('pc') and self.http('cam'):
                    failover = True; break
                time.sleep(.5)
            add('failover', 'Отключение wan1 / резервный маршрут', failover, route)
        return checks

    def diagnostic(self, request):
        device = request['device']
        operation = request['operation']
        if operation in ['addresses', 'interfaces'] and device not in self.namespaces:
            lines = []
            for index, port in enumerate(self.data['configs'][device]['ports'], 1):
                if request.get('interface') and request['interface'] != port:
                    continue
                wire = self.link_ports.get(f'{device}:{port}')
                info = json.loads(execute(['ip', '-j', 'link', 'show', 'dev', wire]).stdout)[0] if wire else {}
                flags = ','.join(info.get('flags', ['NO-CARRIER']))
                lines.append(f'{index}: {port}: <{flags}> mtu {info.get("mtu", 1500)} state {info.get("operstate", "DOWN")}')
            return '\n'.join(lines)
        if device not in self.namespaces:
            if request['operation'] not in ['mac', 'stp']:
                return 'У L2-коммутатора нет IP-интерфейса. Доступны show mac и show spanning-tree.'
            mapping = '\n'.join(f'{execute(["ovs-vsctl", "get", "Interface", wire, "ofport"]).stdout.strip()} / {wire} = {endpoint}' for endpoint, wire in self.link_ports.items() if endpoint.startswith(device + ':'))
            result = execute(['ovs-appctl', 'fdb/show' if request['operation'] == 'mac' else 'rstp/show', self.bridges[device]], check=False)
            return mapping + '\n' + result.stdout + result.stderr
        if request['operation'] == 'neighbors':
            if not self.data['configs'][device]['ospf']:
                return 'OSPF отключён.'
            time.sleep(3)
            result = self.ns(device, ['vtysh', '--vty_socket', str(self.path / device), '-c', 'show ip ospf neighbor'], check=False)
            return result.stdout + result.stderr
        if request['operation'] in ['mac', 'stp']:
            return 'Это не коммутатор.'
        if operation in ['dig', 'nslookup']:
            cfg = self.data['configs'][device]
            dns = request.get('server') or (cfg['dns'] if not cfg['dhcp'] else next(iter(self.dhcp(device).get('dns', [])), None))
            if not dns:
                return 'DNS-сервер не задан; DHCP lease с DNS отсутствует.'
            args = ['dig', '@' + dns, request['target'], request['record'], '+time=1', '+tries=1'] if operation == 'dig' else ['nslookup', '-type=A', '-timeout=1', '-retry=1', request['target'], dns]
            if operation == 'dig' and request['short']:
                args.append('+short')
            result = self.ns(device, args, timeout=4, check=False)
            return result.stdout + result.stderr
        if operation in ['addresses', 'interfaces', 'arp']:
            args = ['ip', '-4', 'addr', 'show'] if operation == 'addresses' else ['ip', 'link' if operation == 'interfaces' else 'neigh', 'show']
            if request.get('interface'):
                args.extend(['dev', request['interface']])
            result = self.ns(device, args, check=False)
            return result.stdout + result.stderr
        target = request.get('target')
        if target == 'archive.lab':
            resolved = self.lookup(device)
            if not resolved:
                return 'DNS: archive.lab не разрешается с выбранного устройства.'
            target = resolved[0]
        args = ['ip', 'route', 'show'] if request['operation'] == 'routes' else ['ping', '-n', '-c', str(request.get('count', 3)), '-W', '1', target] if request['operation'] == 'ping' else ['traceroute', '-n', '-m', '6', '-w', '1', '-q', '1', target]
        result = self.ns(device, args, timeout=9, check=False)
        return result.stdout + result.stderr

    def close(self):
        for process in reversed(self.processes):
            if process.poll() is None:
                process.terminate()
        for process in self.processes:
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
        for bridge in self.bridges.values():
            execute(['ovs-vsctl', '--if-exists', 'del-br', bridge], check=False)
        for namespace in self.namespaces.values():
            execute(['ip', 'netns', 'del', namespace], check=False)
        for interface in self.links:
            execute(['ip', 'link', 'del', interface], check=False)
        shutil.rmtree(self.path)


def unsafe_stp(data):
    switches = {d['id'] for d in data['devices'] if d['kind'] == 'switch'}
    if all(data['configs'][name]['rstp'] for name in switches):
        return False
    parents = {name: name for name in switches}
    def root(name):
        while parents[name] != name:
            name = parents[name]
        return name
    for edge in data['links']:
        a, b = (endpoint.split(':')[0] for endpoint in edge)
        if a in switches and b in switches and data['power'][a] and data['power'][b]:
            x, y = root(a), root(b)
            if x == y:
                return True
            parents[x] = y
    return data['level'] == 'hard'


def verify(data):
    validate(data)
    if unsafe_stp(data):
        return {'nonce': data['nonce'], 'checks': [*data['physical'], {'id': 'rstp', 'name': 'RSTP / допуск резервной L2-топологии', 'ok': False, 'detail': 'RSTP отключён на одном из коммутаторов. Замкнутый L2-контур не допущен к запуску.'}], 'output': 'L2 safety interlock: включите RSTP перед запуском резервного контура.'}
    started = time.monotonic(); runtime = Network(data)
    try:
        runtime.setup()
        if data.get('diagnostic'):
            return {'nonce': data['nonce'], 'checks': [], 'output': runtime.diagnostic(data['diagnostic']), 'seconds': time.monotonic() - started}
        checks = runtime.checks()
    finally:
        runtime.close()
    if data['level'] == 'hard':
        cold = copy.deepcopy(data); cold['configs'] = cold['startup']
        if unsafe_stp(cold):
            checks.append({'id': 'cold-boot', 'name': 'Холодный перезапуск / NVRAM', 'ok': False, 'detail': 'RSTP не сохранён. Опасная startup-топология не допущена к запуску.'})
        else:
            runtime = Network(cold)
            try:
                runtime.setup(); boot = runtime.checks()
                checks.append({'id': 'cold-boot', 'name': 'Холодный перезапуск / NVRAM', 'ok': all(c['ok'] for c in boot), 'detail': ', '.join(c['name'] for c in boot if not c['ok'])})
            finally:
                runtime.close()
    return {'nonce': data['nonce'], 'checks': checks, 'output': '', 'seconds': time.monotonic() - started}
