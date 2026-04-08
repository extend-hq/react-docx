/// <reference types="vite/client" />

declare module "utif" {
  interface TiffIfd {
    width?: number;
    height?: number;
    subIFD?: TiffIfd[];
    t256?: number;
    t257?: number;
  }

  interface UtifModule {
    decode(buffer: ArrayBufferLike): TiffIfd[];
    decodeImage(buffer: ArrayBufferLike, image: TiffIfd, ifds?: TiffIfd[]): void;
    toRGBA8(image: TiffIfd): Uint8Array;
  }

  const UTIF: UtifModule;
  export default UTIF;
}
