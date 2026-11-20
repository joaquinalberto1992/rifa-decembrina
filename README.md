# Rifas de Adriana Yuniva

PWA independiente para la Rifa Decembrina 2026. Este proyecto no usa ni modifica los datos, imágenes, credenciales ni la base Firebase de PhoneIndustry.

## Datos confirmados

- 9,000 números (0001–9000).
- Precio individual: $10 MXN.
- Paquetes confirmados: 10 por $75, 20 por $140 y 100 por $400. Para cantidades intermedias, el sistema aplica la combinación de menor precio usando solo esos paquetes confirmados y el boleto individual.
- Atención y apartado por WhatsApp: +52 479 229 3687.
- Inversión base estimada: $14,984; los permisos y gastos legales adicionales siguen pendientes.
- OXXO se mantiene pendiente de validación y no se ofrece para cobrar.
- Premio: paquete premium de bebidas y accesorios con hielera Igloo, o alternativa de $25,000 MXN en efectivo. Valor estimado mostrado en la referencia: $15,000 MXN. Fecha mostrada: 24 de diciembre de 2026; la hora y el correo administrador deben confirmarse antes de abrir ventas.

## Control financiero

Si “ganar el doble de lo invertido” significa utilidad de 2× el costo, la meta bruta es 3× los costos: $44,952 con la inversión base de $14,984. Si los 9,000 boletos se vendieran todos en paquetes de 100 a $400, el ingreso sería $36,000, una diferencia de $8,952 frente a esa meta antes de nuevos costos. El panel muestra recaudación real según ventas y pagos confirmados; no promete ganancias.

## Apartados y privacidad

- Un pedido de 1–100 boletos se guarda en una transacción Firestore con un documento privado de orden y sus boletos públicos de estado. Si un número ya se tomó, la transacción completa falla y no queda un pedido parcial.
- Las colecciones de órdenes contienen nombre, teléfono y forma de pago. Las reglas Firestore solo permiten leerlas a la cuenta administradora.
- Los boletos públicos contienen únicamente número, estado, fecha de actualización y un ID aleatorio de orden.
- El WhatsApp se abre con el mensaje listo después de confirmar el apartado. La persona debe tocar **Enviar** en WhatsApp; la app no envía mensajes por sí sola.
- El pago se coordina directamente con la organizadora. No hay cuentas bancarias publicadas.
- Los apartados se agrupan por orden para confirmar el pago o liberar esa orden completa. No se libera una orden si incluye boletos pagados.
- El resultado oficial congela las ventas y estados; se guarda una única secuencia de cinco boletos pagados distintos y el quinto es ganador. La simulación no escribe nada.

## Configuración independiente pendiente

La cuenta Google alcanzó la cuota de proyectos y rechazó crear `rifas-adriana-yuniva-2026`. No se debe conectar a un proyecto de otra rifa ni a PhoneIndustry. Cuando exista un proyecto Firebase nuevo y aislado:

1. Crear una app web en ese proyecto, activar Firestore y Email/Password Authentication, y crear la cuenta administradora con el correo confirmado. Definir la hora del sorteo antes de abrir apartados.
2. Sustituir `ADMIN_EMAIL_TO_CONFIGURE` en `firestore.rules` por ese correo exacto en minúsculas y desplegar esas reglas al proyecto nuevo.
3. Completar `.env.example` localmente con la configuración web de ese proyecto; no subir `.env.local` ni contraseñas.
4. Añadir a Vercel las variables públicas `NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_ADMIN_EMAIL`, `NEXT_PUBLIC_RAFFLE_PRIZE` y `NEXT_PUBLIC_DRAW_DATE`. Añadir como secretos privados `ADMIN_EMAIL` y `ADMIN_PASSWORD` para el endpoint de consulta privada de boleto.
5. Solo después de probar una reserva, colisión de dos reservas, consulta privada, confirmación de pago, liberación, simulación y sorteo de prueba con datos de prueba, habilitar la venta y publicar el enlace.

## Desarrollo

```powershell
npm ci
npm run lint
npm run build
```

La app no tiene credenciales Firebase incluidas. Mientras falte configuración, se puede preparar una solicitud con números sugeridos y abrir WhatsApp al +52 479 229 3687, pero esa solicitud no bloquea boletos ni confirma disponibilidad. Para apartados sin colisiones, pagos y conteos en vivo se requiere configurar Firebase nuevo y exclusivo de esta rifa.
