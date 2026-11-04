export function remoteServer(input: string): { roomUrl: string; inviteBase: string } {
  const url = new URL(input.trim());
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (!local && url.protocol !== 'https:') || (local && !['http:', 'https:'].includes(url.protocol))) {
    throw new Error('請貼上主機提供的完整 HTTPS 邀請網址。');
  }
  const access = url.searchParams.get('access');
  if (!local && (!access || !/^[A-Za-z0-9_-]{20,100}$/.test(access))) throw new Error('網址缺少主機通行碼，請貼上完整分享連結。');
  const room = url.searchParams.get('room');
  url.pathname = '/game'; url.search = ''; url.hash = '';
  if (access) url.searchParams.set('access', access);
  if (room) url.searchParams.set('room', room.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32));
  const socket = new URL(url.origin.replace(/^http/, 'ws') + '/rooms');
  if (access) socket.searchParams.set('access', access);
  return { roomUrl: socket.toString(), inviteBase: url.toString() };
}
