const result = document.querySelector('#result');
const submit = document.querySelector('#submit');
const parts = ['melody', 'bass', 'rhythm'];
const show = (message, state = '') => {
  result.textContent = message;
  result.dataset.state = state;
  result.hidden = !message;
};

Promise.all(['rhythm', 'bass'].map(async part => {
  const response = await fetch(`/scores/${part}.abc`);
  if (!response.ok) throw new Error('Не удалось загрузить исходные партии.');
  document.getElementById(part).value = await response.text();
})).then(() => {
  submit.disabled = false;
}).catch(error => { show(error.message, 'error'); });

document.querySelector('#score-form').addEventListener('submit', async event => {
  event.preventDefault();
  submit.disabled = true;
  show('Исполняем партитуру…');
  try {
    const payload = Object.fromEntries(parts.map(part => [part, document.getElementById(part).value]));
    const response = await fetch('/solve', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Партитура отклонена.');
    show(data.flag, 'success');
  } catch (error) { show(error.message, 'error'); }
  finally { submit.disabled = false; }
});
