import {afterEach, describe, expect, it, vi} from 'vitest';
import {copyLink} from './copy-link';

afterEach(() => vi.unstubAllGlobals());
function setup(native?: () => Promise<boolean>, web?: () => Promise<void>, legacy = false) {
  vi.stubGlobal('window', {labuHost:native ? {copyLink:vi.fn(native)} : undefined});
  vi.stubGlobal('navigator', {clipboard:web ? {writeText:vi.fn(web)} : undefined});
  vi.stubGlobal('document', {execCommand:vi.fn(() => legacy)});
  return {value:'https://example.test/game?access=secret&room=ABCD',focus:vi.fn(),select:vi.fn()} as unknown as HTMLInputElement;
}
describe('copy invitation link', () => {
  it('uses desktop clipboard even when browser API denies access', async () => {
    const web=vi.fn(async()=>{throw Error('denied');});
    const input=setup(async()=>true,web);
    expect(await copyLink(input)).toBe(true);
    expect(window.labuHost!.copyLink).toHaveBeenCalledWith(input.value);
    expect(web).not.toHaveBeenCalled();
  });
  it('copies in a browser without a desktop bridge', async () => {
    const input=setup(undefined,async()=>{});
    expect(await copyLink(input)).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(input.value);
  });
  it('uses selected text fallback when clipboard permission is rejected', async () => {
    const input=setup(undefined,async()=>{throw Error('denied');},true);
    expect(await copyLink(input)).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
  it('returns failure and leaves link selected for manual copying', async () => {
    const input=setup(async()=>{throw Error('IPC unavailable');},undefined,false);
    expect(await copyLink(input)).toBe(false);
    expect(input.select).toHaveBeenCalled();
  });
});
