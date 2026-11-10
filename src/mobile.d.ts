export {};

declare global {
  interface Window {
    VesperAndroid?: {
      saveBase64: (name: string, base64: string, mime: string) => string;
      shareText: (text: string) => void;
    };
  }
}
