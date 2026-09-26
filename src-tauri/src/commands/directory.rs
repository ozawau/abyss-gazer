#[cfg(target_os = "android")]
use std::sync::mpsc;
#[cfg(target_os = "android")]
use std::time::{Duration, Instant};

#[cfg(target_os = "android")]
use tauri::{AppHandle, Manager};

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn pick_directory() -> Result<Option<String>, String> {
    Err("目录选择请使用系统对话框".into())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    on_android_ui(&app, |env, activity, _webview| {
        call_picker_launch(env, activity)
    })?;

    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        if Instant::now() > deadline {
            return Err("选择目录超时".into());
        }
        let state = on_android_ui(&app, |env, activity, _webview| read_picker_state(env, activity))?;
        if state == "pending" || state.is_empty() {
            std::thread::sleep(Duration::from_millis(200));
            continue;
        }
        if state == "cancel" {
            return Ok(None);
        }
        if let Some(message) = state.strip_prefix("error:") {
            return Err(message.to_string());
        }
        if let Some(path) = state.strip_prefix("ok:") {
            return Ok(Some(path.to_string()));
        }
        return Err(state);
    }
}

#[cfg(target_os = "android")]
fn on_android_ui<T, F>(app: &AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut jni::JNIEnv, &jni::objects::JObject, &jni::objects::JObject) -> Result<T, String>
        + Send
        + 'static,
{
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;
    let (tx, rx) = mpsc::channel();
    window
        .with_webview(move |webview| {
            webview.jni_handle().exec(move |env, activity, webview| {
                let _ = tx.send(f(env, activity, webview));
            });
        })
        .map_err(|err| format!("打开目录选择器失败: {err}"))?;
    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(result) => result,
        Err(_) => Err("目录选择器没有响应".into()),
    }
}

#[cfg(target_os = "android")]
fn picker_class<'a>(
    env: &mut jni::JNIEnv<'a>,
    activity: &jni::objects::JObject<'_>,
) -> Result<jni::objects::JClass<'a>, String> {
    let name = env
        .new_string("com.abyssgazer.desktop.DirectoryPicker")
        .map_err(|err| err.to_string())?;
    let class = env
        .call_method(
            activity,
            "getAppClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[jni::objects::JValue::Object(&name)],
        )
        .map_err(|err| format!("找不到目录选择器: {err}"))?
        .l()
        .map_err(|err| err.to_string())?;
    Ok(class.into())
}

#[cfg(target_os = "android")]
fn call_picker_launch(
    env: &mut jni::JNIEnv,
    activity: &jni::objects::JObject,
) -> Result<(), String> {
    let class = picker_class(env, activity)?;
    env.call_static_method(
        class,
        "launch",
        "(Landroid/app/Activity;)V",
        &[jni::objects::JValue::Object(activity)],
    )
    .map_err(|err| format!("无法打开目录选择器: {err}"))?;
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
        return Err("无法打开目录选择器".into());
    }
    Ok(())
}

#[cfg(target_os = "android")]
fn read_picker_state(
    env: &mut jni::JNIEnv,
    activity: &jni::objects::JObject,
) -> Result<String, String> {
    let class = picker_class(env, activity)?;
    let value = env
        .get_static_field(class, "state", "Ljava/lang/String;")
        .map_err(|err| format!("读取目录选择结果失败: {err}"))?
        .l()
        .map_err(|err| err.to_string())?;
    if value.is_null() {
        return Ok(String::new());
    }
    let text: String = env
        .get_string(&jni::objects::JString::from(value))
        .map_err(|err| err.to_string())?
        .into();
    Ok(text)
}
