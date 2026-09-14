package com.example.demo.controller;

import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.FieldValue;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.WriteBatch;
import com.google.firebase.cloud.FirestoreClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.HashMap;

@RestController
@RequestMapping("/api/ventas")
@CrossOrigin(origins = "*")
public class VentaController {

    @PostMapping("/procesar")
    public ResponseEntity<?> procesarVenta(@RequestBody Map<String, Object> datosVenta) {
        try {
            Firestore db = FirestoreClient.getFirestore();
            WriteBatch batch = db.batch();
            datosVenta.put("timestamp", FieldValue.serverTimestamp());

            // 1. Crear referencia para el nuevo documento de venta
            DocumentReference nuevaVentaRef = db.collection("ventas").document();
            Map<String, Object> ventaConTimestamp = new HashMap<>(datosVenta);
            ventaConTimestamp.put("timestamp", FieldValue.serverTimestamp());
            batch.set(nuevaVentaRef, ventaConTimestamp);

            // 2. Procesar el descuento de stock para cada item vendido
            List<Map<String, Object>> items = (List<Map<String, Object>>) datosVenta.get("items");

            if (items != null) {
                for (Map<String, Object> item : items) {
                    String productoId = (String) item.get("productoId");
                    Number cantidadNum = (Number) item.get("cantidad");
                    long cantidad = cantidadNum != null ? cantidadNum.longValue() : 0;

                    if (productoId != null && cantidad > 0) {
                        DocumentReference productoRef = db.collection("productos").document(productoId);
                        // Restamos la cantidad de stock de forma atómica en Firestore
                        batch.update(productoRef, "stock", FieldValue.increment(-cantidad));
                    }
                }
            }

            // 3. Ejecutar todas las operaciones juntas en una sola transacción
            batch.commit().get();

            System.out.println("✅ Venta registrada y stock descontado exitosamente.");
            return ResponseEntity.ok(Map.of("status", "success", "message", "Venta y stock procesados correctamente"));

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.internalServerError().body(Map.of("status", "error", "message", e.getMessage()));
        }
    }
}