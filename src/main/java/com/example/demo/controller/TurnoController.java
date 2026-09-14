package com.example.demo.controller;

import com.google.cloud.firestore.*;
import com.google.firebase.cloud.FirestoreClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/turnos")
@CrossOrigin(origins = "*")
public class TurnoController {

    /**
     * Consulta si un empleado tiene un turno actualmente en estado 'abierto'.
     */
    @GetMapping("/activo/{empleadoId}")
    public ResponseEntity<?> obtenerTurnoActivo(@PathVariable String empleadoId) {
        try {
            Firestore db = FirestoreClient.getFirestore();
            List<QueryDocumentSnapshot> docs = db.collection("turnos")
                    .whereEqualTo("empleadoId", empleadoId)
                    .whereEqualTo("estado", "abierto")
                    .get().get().getDocuments();

            if (!docs.isEmpty()) {
                DocumentSnapshot doc = docs.get(0);
                Map<String, Object> respuesta = new HashMap<>();
                respuesta.put("activo", true);
                respuesta.put("turnoId", doc.getId());

                // Convertimos el Timestamp de Firestore a un ISO String legible para JavaScript
                if (doc.contains("fechaApertura") && doc.get("fechaApertura") != null) {
                    respuesta.put("fechaApertura", doc.getTimestamp("fechaApertura").toDate().toInstant().toString());
                } else {
                    respuesta.put("fechaApertura", java.time.Instant.now().toString());
                }

                return ResponseEntity.ok(respuesta);
            }

            return ResponseEntity.ok(Map.of("activo", false));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.internalServerError().body(Map.of("status", "error", "message", e.getMessage()));
        }
    }

    /**
     * Registra la apertura de caja e inicia un nuevo turno.
     */
    @PostMapping("/abrir")
    public ResponseEntity<?> abrirTurno(@RequestBody Map<String, Object> datosTurno) {
        try {
            Firestore db = FirestoreClient.getFirestore();
            datosTurno.put("estado", "abierto");
            datosTurno.put("fechaApertura", FieldValue.serverTimestamp());

            DocumentReference ref = db.collection("turnos").add(datosTurno).get();

            Map<String, Object> respuesta = new HashMap<>();
            respuesta.put("status", "success");
            respuesta.put("turnoId", ref.getId());

            System.out.println("🔓 Turno abierto exitosamente: " + ref.getId());
            return ResponseEntity.ok(respuesta);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.internalServerError().body(Map.of("status", "error", "message", e.getMessage()));
        }
    }

    /**
     * Cierra el turno actual y guarda el monto final de caja.
     */
    @PostMapping("/cerrar")
    public ResponseEntity<?> cerrarTurno(@RequestBody Map<String, Object> datosCierre) {
        try {
            Firestore db = FirestoreClient.getFirestore();
            String turnoId = (String) datosCierre.get("turnoId");
            double cajaFinalMonto = Double.parseDouble(datosCierre.get("cajaFinal").toString());

            DocumentReference turnoRef = db.collection("turnos").document(turnoId);

            Map<String, Object> actualizaciones = new HashMap<>();
            actualizaciones.put("cajaFinal", cajaFinalMonto);
            actualizaciones.put("fechaCierre", FieldValue.serverTimestamp());
            actualizaciones.put("estado", "cerrado");

            turnoRef.update(actualizaciones).get();

            System.out.println("🔒 Turno cerrado exitosamente: " + turnoId);
            return ResponseEntity.ok(Map.of("status", "success", "message", "Turno cerrado correctamente"));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.internalServerError().body(Map.of("status", "error", "message", e.getMessage()));
        }
    }
}