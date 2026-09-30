#[cfg(target_os = "android")]
use std::sync::mpsc;
#[cfg(target_os = "android")]
use std::time::Duration;

#[cfg(target_os = "android")]
use jni::objects::{JByteArray, JObject, JString, JValue};
#[cfg(target_os = "android")]
use tauri::{AppHandle, Manager};

#[cfg(target_os = "android")]
pub fn with_android_activity<T, F>(app: &AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut jni::JNIEnv, &JObject) -> Result<T, String> + Send + 'static,
{
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;
    let (tx, rx) = mpsc::channel();
    window
        .with_webview(move |webview| {
            webview.jni_handle().exec(move |env, activity, _webview| {
                let _ = tx.send(f(env, activity));
            });
        })
        .map_err(|err| format!("Android 调用失败: {err}"))?;
    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(result) => result,
        Err(_) => Err("Android 调用超时".into()),
    }
}

#[cfg(target_os = "android")]
fn pomodoro_class<'a>(
    env: &mut jni::JNIEnv<'a>,
    activity: &JObject,
) -> Result<jni::objects::JClass<'a>, String> {
    let name = env
        .new_string("com.abyssgazer.desktop.PomodoroAndroid")
        .map_err(|err| err.to_string())?;
    let class = env
        .call_method(
            activity,
            "getAppClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&name)],
        )
        .map_err(|err| format!("找不到 PomodoroAndroid: {err}"))?
        .l()
        .map_err(|err| err.to_string())?;
    Ok(class.into())
}

#[cfg(target_os = "android")]
fn jstring<'local>(
    env: &mut jni::JNIEnv<'local>,
    value: &str,
) -> Result<JString<'local>, String> {
    env.new_string(value).map_err(|err| err.to_string())
}

#[cfg(target_os = "android")]
fn clear_exception(env: &mut jni::JNIEnv, context: &str) -> Result<(), String> {
    if !env.exception_check().unwrap_or(false) {
        return Ok(());
    }
    let thrown = env.exception_occurred().ok();
    let _ = env.exception_clear();
    if let Some(exception) = thrown {
        if let Ok(msg_obj) = env.call_method(
            &exception,
            "getMessage",
            "()Ljava/lang/String;",
            &[],
        ) {
            if let Ok(jstr) = msg_obj.l() {
                if !jstr.is_null() {
                    if let Ok(text) = env.get_string(&JString::from(jstr)) {
                        let detail: String = text.into();
                        if !detail.is_empty() {
                            return Err(detail);
                        }
                    }
                }
            }
        }
    }
    Err(context.into())
}

#[cfg(target_os = "android")]
pub fn read_sound_bytes(app: &AppHandle, path: &str) -> Result<Vec<u8>, String> {
    let path = path.to_string();
    with_android_activity(app, move |env, activity| {
        let class = pomodoro_class(env, activity)?;
        let jpath = jstring(env, &path)?;
        let bytes = env
            .call_static_method(
                class,
                "readSoundBytes",
                "(Landroid/app/Activity;Ljava/lang/String;)[B",
                &[JValue::Object(activity), JValue::Object(&jpath)],
            )
            .map_err(|err| format!("无法读取音频: {err}"))?;
        clear_exception(env, "无法读取音频")?;
        let array = bytes.l().map_err(|err| err.to_string())?;
        if array.is_null() {
            return Err("无法读取音频".into());
        }
        let jarray = JByteArray::from(array);
        let len = env
            .get_array_length(&jarray)
            .map_err(|err| err.to_string())? as usize;
        let mut buf = vec![0i8; len];
        env.get_byte_array_region(&jarray, 0, &mut buf)
            .map_err(|err| err.to_string())?;
        Ok(buf.into_iter().map(|b| b as u8).collect())
    })
}

#[cfg(target_os = "android")]
pub fn persist_sound_file(app: &AppHandle, path: &str) -> Result<String, String> {
    let path = path.to_string();
    with_android_activity(app, move |env, activity| {
        let class = pomodoro_class(env, activity)?;
        let jpath = jstring(env, &path)?;
        let dest = env
            .call_static_method(
                class,
                "persistSoundFile",
                "(Landroid/app/Activity;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(activity), JValue::Object(&jpath)],
            )
            .map_err(|err| format!("无法保存音频: {err}"))?;
        clear_exception(env, "无法保存音频")?;
        let obj = dest.l().map_err(|err| err.to_string())?;
        if obj.is_null() {
            return Err("无法保存音频".into());
        }
        let text: String = env
            .get_string(&JString::from(obj))
            .map_err(|err| err.to_string())?
            .into();
        Ok(text)
    })
}

#[cfg(target_os = "android")]
pub fn vibrate_pomodoro_end(app: &AppHandle) -> Result<(), String> {
    with_android_activity(app, |env, activity| {
        let class = pomodoro_class(env, activity)?;
        env.call_static_method(
            class,
            "vibrateEnd",
            "(Landroid/app/Activity;)V",
            &[JValue::Object(activity)],
        )
        .map_err(|err| format!("震动失败: {err}"))?;
        clear_exception(env, "震动失败")?;
        Ok(())
    })
}

#[cfg(target_os = "android")]
pub fn update_timer_notification(
    app: &AppHandle,
    clock: &str,
    focus_phase: bool,
    active: bool,
    paused: bool,
) -> Result<(), String> {
    let clock = clock.to_string();
    with_android_activity(app, move |env, activity| {
        let class = pomodoro_class(env, activity)?;
        let jclock = jstring(env, &clock)?;
        env.call_static_method(
            class,
            "updateTimerNotification",
            "(Landroid/app/Activity;Ljava/lang/String;ZZZ)V",
            &[
                JValue::Object(activity),
                JValue::Object(&jclock),
                JValue::Bool(focus_phase as u8),
                JValue::Bool(active as u8),
                JValue::Bool(paused as u8),
            ],
        )
        .map_err(|err| format!("无法更新通知: {err}"))?;
        clear_exception(env, "无法更新通知")?;
        Ok(())
    })
}
