package com.pos2013.offline

import android.app.Application
import com.pos2013.offline.config.GatewayConfig
import com.pos2013.offline.worker.SyncScheduler
import timber.log.Timber

/**
 * Application class for POS Offline.
 * Initializes logging, gateway configuration, and background sync.
 */
class PosApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        
        // Initialize Timber for logging
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        }
        
        // Initialize GatewayConfig with app context
        GatewayConfig.initialize(this)
        
        // Schedule background sync worker
        // This runs every 15 minutes to sync pending transactions
        SyncScheduler.schedule(this)
        
        Timber.d("POS Application initialized. Background sync scheduled.")
    }
}
