import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * MaletasPorDia.java — Verificador de demanda real de maletas.
 *
 * Formato de línea (spec oficial):
 *   id_pedido-aaaammdd-hh-mm-dest-###-IdClien
 *   00000001-20250102-01-38-EBCI-006-0007729
 *
 *   partes[0] = id_pedido
 *   partes[1] = fecha (aaaammdd)
 *   partes[2] = hh
 *   partes[3] = mm
 *   partes[4] = destino ICAO
 *   partes[5] = ### = cantidadMaletas (3 posiciones: 001..999)  ← CORRECTO
 *   partes[6] = IdCliente (7 posiciones: 0000001..9999999)
 *
 * Uso:
 *   java MaletasPorDia                         → primeras 20 fechas
 *   java MaletasPorDia 20260102 5              → solo 5 dias desde 20260102
 */
public class MaletasPorDia {

    public static void main(String[] args) {
        String carpeta = ".";
        String fechaInicio = null;
        int numDias = Integer.MAX_VALUE;

        if (args.length >= 1) fechaInicio = args[0];
        if (args.length >= 2) numDias = Integer.parseInt(args[1]);

        Map<String, Long> maletasPorDia = new TreeMap<>();
        Map<String, Map<String, Long>> maletasPorArchivoFecha = new TreeMap<>();

        try (DirectoryStream<Path> stream = Files.newDirectoryStream(Paths.get(carpeta), "_envios_*.txt")) {
            for (Path archivo : stream) {
                String nombreArchivo = archivo.getFileName().toString();

                try (BufferedReader br = Files.newBufferedReader(archivo)) {
                    String linea;
                    while ((linea = br.readLine()) != null) {
                        String[] partes = linea.split("-");

                        // Formato espera exactamente 7 partes
                        if (partes.length != 7) continue;

                        String fecha  = partes[1]; // aaaammdd
                        long maletas;
                        try {
                            maletas = Long.parseLong(partes[5].trim()); // ### maletas (3 dig)
                        } catch (NumberFormatException e) {
                            continue;
                        }

                        // Filtro por rango de fechas si se especifica
                        if (fechaInicio != null && fecha.compareTo(fechaInicio) < 0) continue;
                        if (fechaInicio != null) {
                            // Calcular fecha límite
                            // Usamos comparación lexicográfica simple (mismo año/mes facilita esto)
                            // Para exactitud, calculamos el offset en días
                            if (numDias < Integer.MAX_VALUE) {
                                String fechaFin = calcularFechaFin(fechaInicio, numDias - 1);
                                if (fecha.compareTo(fechaFin) > 0) continue;
                            }
                        }

                        maletasPorDia.merge(fecha, maletas, Long::sum);
                        maletasPorArchivoFecha
                            .computeIfAbsent(fecha, k -> new TreeMap<>())
                            .merge(nombreArchivo, maletas, Long::sum);
                    }
                }
            }
        } catch (IOException e) {
            System.out.println("Error: " + e.getMessage());
            return;
        }

        // === Reporte ===
        System.out.println("=======================================================");
        System.out.println("  DEMANDA REAL DE MALETAS POR FECHA");
        if (fechaInicio != null)
            System.out.println("  Rango: " + fechaInicio + " · " + numDias + " dias");
        System.out.println("=======================================================");
        System.out.printf("%-12s | %15s%n", "FECHA", "TOTAL MALETAS");
        System.out.println("-------------------------------------------------------");

        long sumaGlobal = 0;
        int contador = 0;
        for (Map.Entry<String, Long> e : maletasPorDia.entrySet()) {
            System.out.printf("%-12s | %,15d%n", e.getKey(), e.getValue());
            sumaGlobal += e.getValue();
            contador++;
        }

        System.out.println("=======================================================");
        System.out.printf("TOTAL %d dias       : %,15d maletas%n", contador, sumaGlobal);
        if (contador > 0)
            System.out.printf("PROMEDIO por dia   : %,15d maletas%n", sumaGlobal / contador);
        System.out.println("=======================================================");
    }

    /**
     * Suma numDias dias a una fecha en formato aaaammdd.
     * Simple: usa Calendar para no depender de java.time en scripts standalone.
     */
    private static String calcularFechaFin(String fechaStr, int diasExtra) {
        int anio = Integer.parseInt(fechaStr.substring(0, 4));
        int mes  = Integer.parseInt(fechaStr.substring(4, 6)) - 1; // 0-indexed
        int dia  = Integer.parseInt(fechaStr.substring(6, 8));

        java.util.Calendar cal = java.util.Calendar.getInstance();
        cal.set(anio, mes, dia);
        cal.add(java.util.Calendar.DAY_OF_MONTH, diasExtra);

        return String.format("%04d%02d%02d",
            cal.get(java.util.Calendar.YEAR),
            cal.get(java.util.Calendar.MONTH) + 1,
            cal.get(java.util.Calendar.DAY_OF_MONTH));
    }
}