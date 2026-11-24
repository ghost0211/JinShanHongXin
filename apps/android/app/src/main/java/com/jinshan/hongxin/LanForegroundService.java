package com.jinshan.hongxin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;

/**
 * Lightweight foreground keep-alive service active only while hosting a LAN room.
 * Prevents Android from aggressively throttling local sockets during brief app switches.
 */
public final class LanForegroundService extends Service {
    public static final String EXTRA_SUMMARY = "summary";
    private static final String CHANNEL_ID = "jinshan_lan_host";
    private static final int NOTIF_ID = 3001;

    private WifiManager.WifiLock wifiLock;

    public static void start(Context context, String summary) {
        try {
            Intent intent = new Intent(context, LanForegroundService.class);
            intent.putExtra(EXTRA_SUMMARY, summary);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Throwable ignored) {
            // Gracefully degrade if OS restricts foreground service start
        }
    }

    public static void stop(Context context) {
        try {
            context.stopService(new Intent(context, LanForegroundService.class));
        } catch (Throwable ignored) {
            // ignore
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String summary = intent != null ? intent.getStringExtra(EXTRA_SUMMARY) : null;
        if (summary == null || summary.isEmpty()) {
            summary = "局域网牌桌运行中，点击返回游戏";
        }
        acquireWifiLock();
        try {
            Notification notification = buildNotification(summary);
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIF_ID, notification);
            }
        } catch (Throwable ignored) {
            // Do not crash if notification/FGS is blocked by system policy
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWifiLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildNotification(String text) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID,
                    "局域网牌桌保活",
                    NotificationManager.IMPORTANCE_LOW
                );
                ch.setDescription("作为局域网房主开房期间保持连接稳定");
                nm.createNotificationChannel(ch);
            }
        }

        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, launch, piFlags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        return builder
            .setContentTitle("金山打红心 · 局域网开房中")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build();
    }

    @SuppressWarnings("deprecation")
    private void acquireWifiLock() {
        try {
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifiLock = wm.createWifiLock(mode, "jinshan:lan-host");
                    wifiLock.setReferenceCounted(false);
                    wifiLock.acquire();
                }
            }
        } catch (Throwable ignored) {
            // ignore
        }
    }

    private void releaseWifiLock() {
        if (wifiLock != null) {
            try {
                if (wifiLock.isHeld()) wifiLock.release();
            } catch (Throwable ignored) {
                // ignore
            }
            wifiLock = null;
        }
    }
}
