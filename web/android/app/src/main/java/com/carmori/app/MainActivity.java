package com.carmori.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins are not npm packages, so register them before the bridge starts.
        registerPlugin(CarConnectionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
