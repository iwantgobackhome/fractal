import org.gradle.api.artifacts.component.ModuleComponentIdentifier
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "app.fractal.reader"
    compileSdk = 35
    defaultConfig {
        applicationId = "app.newspapers.reader"
        minSdk = 29
        targetSdk = 35
        versionCode = 11
        versionName = "0.4.2"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    val ciDebugKeystorePath = providers.environmentVariable("FRACTAL_ANDROID_KEYSTORE_PATH").orNull
    if (System.getenv("GITHUB_ACTIONS") == "true") {
        require(!ciDebugKeystorePath.isNullOrBlank()) { "CI must provide the verified debug signing store path" }
    }
    if (!ciDebugKeystorePath.isNullOrBlank()) {
        val ciDebugKeystore = file(ciDebugKeystorePath)
        require(ciDebugKeystore.isAbsolute && ciDebugKeystore.isFile) { "Verified CI debug signing store is missing" }
        signingConfigs.getByName("debug") {
            storeFile = ciDebugKeystore
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    testOptions { unitTests.isReturnDefaultValues = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":design"))
    implementation(project(":ink"))
    implementation(project(":data"))
    implementation(project(":sync"))
    implementation(project(":pdf"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.activity)
    implementation(libs.appcompat)
    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.mlkit.barcode)
    implementation(libs.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.coroutines.android)
    implementation(libs.room.ktx)
    implementation(libs.lifecycle.runtime.compose)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation(libs.testng)
}

tasks.withType<Test>().configureEach { useTestNG() }

// Resolve POM metadata for the actual variant runtime graph using existing
// Google/Maven repositories. Follow parent POMs for inherited license metadata.
// Extract embedded license/notice text from runtime JAR/AAR files as available.
val repositoryRoot = rootProject.projectDir.parentFile.parentFile
listOf("debug", "release").forEach { variant ->
    val capitalized = variant.replaceFirstChar { it.uppercase() }
    val generate = tasks.register("generate${capitalized}LicenseNotices") {
        val output = layout.buildDirectory.dir("generated/licenseAssets/$variant")
        outputs.dir(output)
        outputs.upToDateWhen { false }
        doLast {
            val directory = output.get().asFile.resolve("licenses").apply { mkdirs() }
            listOf("LICENSE", "THIRD_PARTY_NOTICES.md").forEach { repositoryRoot.resolve(it).copyTo(directory.resolve(it), overwrite = true) }
            val runtime = configurations.getByName("${variant}RuntimeClasspath")
            val components = runtime.incoming.resolutionResult.allComponents.mapNotNull { it.id as? ModuleComponentIdentifier }.distinctBy { "${it.group}:${it.module}:${it.version}" }.sortedBy { "${it.group}:${it.module}:${it.version}" }
            val factory = DocumentBuilderFactory.newInstance().apply {
                setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
                setFeature("http://xml.org/sax/features/external-general-entities", false)
                setFeature("http://xml.org/sax/features/external-parameter-entities", false)
            }
            fun pom(group: String, name: String, version: String, visited: MutableSet<String>): Pair<List<String>, String> {
                val coordinate = "$group:$name:$version"
                if (!visited.add(coordinate)) return emptyList<String>() to ""
                val files = configurations.detachedConfiguration(dependencies.create("$coordinate@pom")).apply { isTransitive = false }.resolve()
                val doc = factory.newDocumentBuilder().parse(files.single())
                val licenses = doc.getElementsByTagName("license")
                val values = (0 until licenses.length).map { index ->
                    val node = licenses.item(index)
                    val children = node.childNodes
                    (0 until children.length).mapNotNull { child -> children.item(child).takeIf { it.nodeName in listOf("name", "url", "comments") }?.textContent?.trim() }.joinToString(" — ")
                }
                val scm = doc.getElementsByTagName("scm").item(0)?.textContent?.trim().orEmpty()
                if (values.isNotEmpty()) return values to scm
                val parent = doc.getElementsByTagName("parent").item(0) ?: return values to scm
                fun field(name: String): String = (0 until parent.childNodes.length).map { parent.childNodes.item(it) }.first { it.nodeName == name }.textContent.trim()
                val inherited = pom(field("groupId"), field("artifactId"), field("version"), visited)
                return inherited.first to scm.ifBlank { inherited.second }
            }
            val artifacts = runtime.incoming.artifactView { componentFilter { it is ModuleComponentIdentifier } }.artifacts.artifacts.groupBy {
                val id = it.id.componentIdentifier as ModuleComponentIdentifier
                "${id.group}:${id.module}:${id.version}"
            }
            val result = StringBuilder("News Papers — Android third-party licenses\nGenerated from $variant runtimeClasspath resolved components and Maven POMs (including inherited parent licenses). Embedded license/notice texts are included when available. POM URLs identify upstream full license texts where artifacts contain none.\n\n")
            listOf("pretendard-1.3.9.txt", "source-serif-4.txt").forEach { font ->
                result.append("Bundled font: $font\n${repositoryRoot.resolve("scripts/license-texts/$font").readText()}\n\n")
            }
            components.forEach { id ->
                val coordinate = "${id.group}:${id.module}:${id.version}"
                val metadata = pom(id.group, id.module, id.version, mutableSetOf())
                result.append("$coordinate\nLicense: ${metadata.first.joinToString("; ").ifBlank { "Not specified by upstream POM" }}\nRepository: ${metadata.second.ifBlank { "Not specified by upstream POM" }}\n")
                var found = false
                artifacts[coordinate].orEmpty().forEach { artifact ->
                    if (artifact.file.extension in listOf("jar", "aar")) ZipFile(artifact.file).use { zip ->
                        zip.entries().asSequence().filter { !it.isDirectory && Regex("(?i)(license|licence|notice|copying|ofl)([._-].*)?").matches(it.name.substringAfterLast('/')) }.forEach { entry ->
                            found = true
                            result.append("\n${entry.name}\n${zip.getInputStream(entry).bufferedReader().use { it.readText() }}\n")
                        }
                    }
                }
                if (!found) result.append("No license text embedded in artifact; consult the license URL or upstream repository above.\n")
                result.append("\n${"=".repeat(80)}\n\n")
            }
            directory.resolve("android-third-party.txt").writeText(result.toString())
            repositoryRoot.resolve("dist/licenses").apply { mkdirs() }.resolve("android-third-party.txt").writeText(result.toString())
        }
    }
    android.sourceSets.getByName(variant).assets.srcDir(layout.buildDirectory.dir("generated/licenseAssets/$variant"))
    tasks.matching { it.name == "merge${capitalized}Assets" }.configureEach { dependsOn(generate) }
}
