plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Firebase (needed for incoming call alerts) is switched on only when you have added google-services.json.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.teetogreengolf.callscreener"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.teetogreengolf.callscreener"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "0.1.0"
        buildConfigField("String", "BASE_URL", "\"${project.property("BASE_URL")}\"")
    }

    // A fixed key, so each new build installs over the last one without uninstalling.
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    // Play Store upload key: only used when the build is given these values (see android/PLAY_STORE.md).
    val uploadKeystore = System.getenv("UPLOAD_KEYSTORE_PATH")
    if (!uploadKeystore.isNullOrEmpty() && file(uploadKeystore).exists()) {
        signingConfigs {
            create("upload") {
                storeFile = file(uploadKeystore)
                storePassword = System.getenv("UPLOAD_STORE_PASSWORD")
                keyAlias = System.getenv("UPLOAD_KEY_ALIAS")
                keyPassword = System.getenv("UPLOAD_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("upload")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("com.twilio:voice-android:6.10.4")
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
