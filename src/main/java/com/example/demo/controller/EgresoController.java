package com.example.demo.controller;

import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.FieldValue;
import com.google.cloud.firestore.Firestore;
import com.google.firebase.cloud.FirestoreClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/egresos")
@CrossOrigin(origins = "*")
public class EgresoController {

    @PostMapping("/registrar")
    public ResponseEntity<?> registrarEgreso(@RequestBody Map<String, Object> datosEgreso) {
        try {
            Firestore db = FirestoreClient.getFirestore();

            // Asignamos la marca de tiempo oficial del servidor Firebase
            datosEgreso.put("fecha", FieldValue.serverTimestamp());

            // Guardamos el egreso en la colección "egresos" de Firestore
            DocumentReference ref = db.collection("egresos").add(datosEgreso).get();

            System.out.println("💸 Egreso registrado exitosamente con ID: " + ref.getId());

            return ResponseEntity.ok(Map.of(
                    "status", "success",
                    "message", "Egreso registrado correctamente",
                    "id", ref.getId()
            ));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.internalServerError().body(Map.of(
                    "status", "error",
                    "message", e.getMessage()
            ));
        }
    }
}