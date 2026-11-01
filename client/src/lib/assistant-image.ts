import { t } from "../i18n";
const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 3_800_000;
const MAX_DIMENSION = 1440;
const COMPRESS_QUALITY = 0.86;

export const ASSISTANT_IMAGE_LIMIT = 3;

export function assistantImageError(file: File): string | null {
  if (!SUPPORTED_TYPES.has(file.type)) return t("只支持 PNG、JPG、WebP 或 GIF 图片。");
  if (file.size > MAX_SOURCE_BYTES) return t("单张图片不能超过 15 MB。");
  return null;
}

async function encodeBitmap(
  bitmap: ImageBitmap,
  maxDimension: number,
  quality: number,
): Promise<string> {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("无法处理图片，请换一张再试。"));
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function compress(blob: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error(t("无法读取这张图片，请换一张再试。"));
  }
  try {
    let dataUrl = await encodeBitmap(bitmap, MAX_DIMENSION, COMPRESS_QUALITY);
    if (dataUrl.length > MAX_DATA_URL_LENGTH) {
      dataUrl = await encodeBitmap(bitmap, 1080, 0.72);
    }
    if (dataUrl.length > MAX_DATA_URL_LENGTH) {
      throw new Error(t("图片压缩后仍然过大，请裁剪后再发送。"));
    }
    return dataUrl;
  } finally {
    bitmap.close();
  }
}

export async function prepareImageFile(file: File): Promise<string> {
  const error = assistantImageError(file);
  if (error) throw new Error(error);
  return compress(file);
}

export async function prepareImageDataUrl(dataUrl: string): Promise<string> {
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(dataUrl)) {
    throw new Error(t("剪贴板里没有可用的图片。"));
  }
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (blob.size > MAX_SOURCE_BYTES) throw new Error(t("剪贴板图片不能超过 15 MB。"));
  return compress(blob);
}
