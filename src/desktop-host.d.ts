interface LabuHostStatus {
  state: 'off' | 'starting' | 'on' | 'error';
  shareUrl: string;
  error: string;
  rooms?: number;
  connections?: number;
}
interface Window {
  labuHost?: {
    copyLink(text: string): Promise<boolean>;
    status(): Promise<LabuHostStatus>;
    start(): Promise<LabuHostStatus>;
    stop(): Promise<LabuHostStatus>;
    background(): void;
    onStatus(callback: (status: LabuHostStatus) => void): void;
  };
}
