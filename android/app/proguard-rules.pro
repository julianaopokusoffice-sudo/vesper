# Capacitor plugins are discovered by reflection through @CapacitorPlugin.
-keep class dev.vesper.app.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class com.getcapacitor.** { *; }
-keep class org.apache.commons.compress.** { *; }
-dontwarn org.apache.commons.compress.**
