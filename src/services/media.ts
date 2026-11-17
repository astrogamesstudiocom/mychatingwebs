import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { storage } from '../firebase';

export interface MediaUploadResult {
  url: string;
  mimeType: string;
  fileName: string;
  backend: 'firebase-storage' | 'web-relay';
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'media';
}

async function uploadToFirebaseStorage(
  blob: Blob,
  storagePath: string,
  mimeType: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, storagePath);
    const task = uploadBytesResumable(storageRef, blob, { contentType: mimeType });

    const timeout = window.setTimeout(() => {
      task.cancel();
      reject(new Error('Firebase Storage upload timed out'));
    }, 12000);

    task.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0 && onProgress) {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress(pct);
        }
      },
      (err) => {
        window.clearTimeout(timeout);
        reject(err);
      },
      async () => {
        window.clearTimeout(timeout);
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

async function uploadToWebRelay(
  blob: Blob,
  fileName: string,
  mimeType: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media/upload');
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.setRequestHeader('x-file-name', fileName);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { url: string };
          resolve(data.url);
        } catch {
          reject(new Error('Invalid response from media upload server'));
        }
      } else {
        reject(new Error(`Media upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during media upload'));
    xhr.send(blob);
  });
}

export async function uploadChatMedia(
  blob: Blob,
  folder: string,
  originalName: string,
  onProgress?: (pct: number) => void
): Promise<MediaUploadResult> {
  const safeName = sanitizeFileName(originalName);
  const mimeType = blob.type || 'application/octet-stream';
  const storagePath = `${folder}/${Date.now()}_${safeName}`;

  try {
    const url = await uploadToFirebaseStorage(blob, storagePath, mimeType, onProgress);
    return { url, mimeType, fileName: safeName, backend: 'firebase-storage' };
  } catch (firebaseErr) {
    console.warn('Firebase Storage unavailable or blocked, falling back to web media endpoint:', firebaseErr);
    const url = await uploadToWebRelay(blob, safeName, mimeType, onProgress);
    return { url, mimeType, fileName: safeName, backend: 'web-relay' };
  }
}
