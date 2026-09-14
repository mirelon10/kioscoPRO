package com.example.demo.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import org.springframework.context.annotation.Configuration;

import jakarta.annotation.PostConstruct;
import java.io.InputStream;

@Configuration
public class FirebaseConfig {

    @PostConstruct
    public void inicializarFirebase() {
        try {
            // Spring Boot buscará el archivo automáticamente dentro de la carpeta 'resources'
            InputStream serviceAccount = getClass().getClassLoader().getResourceAsStream("serviceAccountKey.json");

            if (serviceAccount == null) {
                System.err.println("❌ ERROR: No se encontró el archivo serviceAccountKey.json");
                return;
            }

            FirebaseOptions options = new FirebaseOptions.Builder()
                    .setCredentials(GoogleCredentials.fromStream(serviceAccount))
                    .build();

            // Verificamos que no se haya inicializado antes para evitar errores
            if (FirebaseApp.getApps().isEmpty()) {
                FirebaseApp.initializeApp(options);
                System.out.println("🔥 Firebase inicializado correctamente en el servidor.");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
