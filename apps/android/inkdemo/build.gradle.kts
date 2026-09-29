plugins { alias(libs.plugins.android.application); alias(libs.plugins.kotlin.android); alias(libs.plugins.kotlin.compose) }
android { namespace = "app.fractal.inkdemo"; compileSdk = 35
    defaultConfig { applicationId = "app.fractal.inkdemo"; minSdk = 29; targetSdk = 35; versionCode = 1; versionName = "0.1" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures { compose = true }
}
dependencies { implementation(project(":design")); implementation(project(":ink")); implementation(platform(libs.compose.bom)); implementation(libs.compose.ui); implementation(libs.compose.foundation); implementation(libs.compose.material3); implementation(libs.compose.activity) }
