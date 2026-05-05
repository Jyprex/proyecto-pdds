import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.*;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

public class SuitcaseWindowFinder {

    private static final String RUTA_DATOS = ".";

    public static void main(String[] args) {
        Path dir = Paths.get(RUTA_DATOS);
        Map<LocalDate, Long> maletasPorDia = new TreeMap<>();
        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyyMMdd");

        System.out.println("Iniciando escaneo corregido... (Sumando columna de cantidad ###)");

        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "_envios_*.txt")) {
            for (Path entry : stream) {
                System.out.print("Procesando: " + entry.getFileName() + " ... ");
                int lineasEnArchivo = 0;
                
                try (BufferedReader reader = Files.newBufferedReader(entry)) {
                    String linea;
                    while ((linea = reader.readLine()) != null) {
                        if (linea.trim().isEmpty()) continue;
                        
                        String[] partes = linea.split("-");
                        
                        // VALIDACIÓN DEL FORMATO
                        // partes[1] = Fecha (YYYYMMDD)
                        // partes[5] = Cantidad (###) -> ESTA ES LA CORRECTA
                        if (partes.length >= 6) { 
                            try {
                                LocalDate fecha = LocalDate.parse(partes[1], formatter);
                                // Cambiamos partes.length-1 por partes[5]
                                long cantidad = Long.parseLong(partes[5].trim()); 
                                
                                maletasPorDia.put(fecha, maletasPorDia.getOrDefault(fecha, 0L) + cantidad);
                                lineasEnArchivo++;
                            } catch (Exception e) {
                                // Ignora errores de casteo o fechas
                            }
                        }
                    }
                }
                System.out.println(lineasEnArchivo + " registros analizados.");
            }
        } catch (IOException e) {
            System.err.println("Error al acceder a la ruta: " + RUTA_DATOS);
            return;
        }

        analizarVentanas(maletasPorDia);
    }

    private static void analizarVentanas(Map<LocalDate, Long> datos) {
        if (datos.size() < 5) {
            System.out.println("Error: No hay suficientes días consecutivos.");
            return;
        }

        List<LocalDate> fechas = new ArrayList<>(datos.keySet());
        
        long maxTotal = -1;
        List<LocalDate> ventanaMax = new ArrayList<>();

        long minTotal = Long.MAX_VALUE;
        List<LocalDate> ventanaMin = new ArrayList<>();

        for (int i = 0; i <= fechas.size() - 5; i++) {
            List<LocalDate> ventanaActual = fechas.subList(i, i + 5);
            
            // Verificamos que sean 5 días calendario seguidos
            if (ventanaActual.get(0).plusDays(4).equals(ventanaActual.get(4))) {
                long sumaVentana = 0;
                for (LocalDate d : ventanaActual) sumaVentana += datos.get(d);

                if (sumaVentana > maxTotal) {
                    maxTotal = sumaVentana;
                    ventanaMax = new ArrayList<>(ventanaActual);
                }

                if (sumaVentana < minTotal) {
                    minTotal = sumaVentana;
                    ventanaMin = new ArrayList<>(ventanaActual);
                }
            }
        }

        imprimirReporte("MÁXIMO ESTRÉS (PICO DE DEMANDA)", ventanaMax, datos, maxTotal);
        imprimirReporte("MÍNIMA CARGA (PUNTO BAJO)", ventanaMin, datos, minTotal);
    }

    private static void imprimirReporte(String titulo, List<LocalDate> ventana, Map<LocalDate, Long> datos, long total) {
        if (ventana.isEmpty()) return;
        System.out.println("\n" + "=".repeat(50));
        System.out.println("   " + titulo);
        System.out.println("=".repeat(50));
        System.out.println("RANGO: " + ventana.get(0) + " al " + ventana.get(4));
        System.out.println("TOTAL MALETAS EN 5 DÍAS: " + String.format("%,d", total));
        System.out.println("-".repeat(50));
        for (LocalDate d : ventana) {
            System.out.println(d + " -> " + String.format("%,d", datos.get(d)) + " maletas");
        }
        System.out.println("=".repeat(50));
    }
}