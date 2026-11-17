import { getMessaging, getToken, isSupported, onMessage, type MessagePayload } from 'firebase/messaging';
import { app } from '../firebase';

export interface NotificationInitResult {
  permission: NotificationPermission;
  fcmToken: string | null;
  supported: boolean;
}

export async function registerMessagingAndPermissions(): Promise<NotificationInitResult> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { permission: 'denied', fcmToken: null, supported: false };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    return { permission, fcmToken: null, supported: false };
  }

  try {
    const supported = await isSupported();
    if (!supported || !('serviceWorker' in navigator)) {
      return { permission, fcmToken: null, supported: false };
    }

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = getMessaging(app);
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

    let token: string | null = null;
    try {
      token = await getToken(messaging, {
        serviceWorkerRegistration: registration,
        ...(vapidKey ? { vapidKey } : {}),
      });
    } catch (tokenErr) {
      console.info('FCM push token registration deferred (no VAPID key or browser restriction):', tokenErr);
    }

    return { permission, fcmToken: token || null, supported: true };
  } catch (err) {
    console.warn('Messaging setup fallback to standard Web Notifications:', err);
    return { permission, fcmToken: null, supported: false };
  }
}

export async function subscribeForegroundFcm(
  callback: (payload: MessagePayload) => void
): Promise<() => void> {
  try {
    const supported = await isSupported();
    if (!supported) return () => {};
    const messaging = getMessaging(app);
    return onMessage(messaging, callback);
  } catch {
    return () => {};
  }
}

export function showBrowserNotification(title: string, body: string, tag?: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistration('/firebase-messaging-sw.js')
      .then((reg) => {
        if (reg) {
          void reg.showNotification(title, { body, tag });
        } else {
          new Notification(title, { body, tag });
        }
      })
      .catch(() => {
        new Notification(title, { body, tag });
      });
  } else {
    new Notification(title, { body, tag });
  }
}
