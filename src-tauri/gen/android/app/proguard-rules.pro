# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Called from Rust by class and field name.
-keep class com.abyssgazer.desktop.DirectoryPicker { *; }
-keepclassmembers class com.abyssgazer.desktop.CheckinWidgetProvider {
    public static void refresh(android.content.Context);
    public static boolean requestPin(android.app.Activity);
}
-keep class com.abyssgazer.desktop.CheckinWidgetProvider { *; }
-keep class com.abyssgazer.desktop.CheckinWidgetService { *; }
-keepclassmembers class com.abyssgazer.desktop.NoteTaskWidgetProvider {
    public static void refresh(android.content.Context);
    public static boolean requestPin(android.app.Activity);
}
-keep class com.abyssgazer.desktop.NoteTaskWidgetProvider { *; }
-keep class com.abyssgazer.desktop.NoteTaskInputActivity { *; }