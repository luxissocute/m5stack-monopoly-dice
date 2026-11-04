window.dicePicker.onDevices(({ kind, devices }) => {
  document.querySelector('#title').textContent = kind === 'ble' ? '連接藍牙骰子' : '連接 USB 骰子';
  document.querySelector('#hint').textContent = devices.length ? '點選你要連接的裝置。' : kind === 'ble' ? '正在搜尋 Labu Dice，請確認 C Plus 已開機。' : '未找到連接埠，請接上 C Plus 的 USB 線。';
  const list = document.querySelector('#devices');
  list.replaceChildren(...devices.map(device => {
    const button = document.createElement('button');
    button.textContent = device.name;
    button.onclick = () => window.dicePicker.select(device.id);
    return button;
  }));
});
document.querySelector('#cancel').onclick = () => window.dicePicker.select('');
