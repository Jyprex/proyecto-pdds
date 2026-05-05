import java.io.*;
import java.nio.file.*;
import java.util.*;

public class CalculadorCargaReal {

    public static void main(String[] args) {
        String rutaPlanes = "planes_vuelo.txt";
        String carpetaDatos = "."; 

        long capacidadTotalVuelos = 0;
        // Mapa para acumular maletas por cada fecha: <Fecha, SumaDeMaletas>
        Map<String, Long> maletasPorDia = new TreeMap<>();
        // Mapa para el reporte por origen: <Origen, PromedioEnvios>
        Map<String, Integer> enviosPorOrigen = new TreeMap<>();

        // 1. CALCULAR CAPACIDAD TOTAL (El techo del sistema)
        try (BufferedReader br = new BufferedReader(new FileReader(rutaPlanes))) {
            String linea;
            while ((linea = br.readLine()) != null) {
                linea = linea.trim();
                if (linea.isEmpty() || linea.startsWith("//")) continue;
                String[] partes = linea.split("-");
                if (partes.length >= 5) {
                    try {
                        capacidadTotalVuelos += Integer.parseInt(partes[partes.length - 1].trim());
                    } catch (NumberFormatException e) { }
                }
            }
        } catch (IOException e) {
            System.err.println("Error en planes_vuelo: " + e.getMessage());
        }

        // 2. ESCANEAR ARCHIVOS Y SUMAR MALETAS REALES
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(Paths.get(carpetaDatos), "_envios_*.txt")) {
            for (Path archivo : stream) {
                String nombre = archivo.getFileName().toString();
                String origen = nombre.replace("_envios_", "").replace("_.txt", "");
                
                int conteoEnviosArchivo = 0;
                Set<String> fechasEnEsteArchivo = new HashSet<>();

                try (BufferedReader br = new BufferedReader(new FileReader(archivo.toFile()))) {
                    String linea;
                    while ((linea = br.readLine()) != null) {
                        String[] partes = linea.split("-");
                        if (partes.length >= 6) {
                            String fecha = partes[1];
                            int cantidadMaletas = Integer.parseInt(partes[5].trim());

                            // Acumulamos en el mapa global por día
                            maletasPorDia.put(fecha, maletasPorDia.getOrDefault(fecha, 0L) + cantidadMaletas);
                            
                            fechasEnEsteArchivo.add(fecha);
                            conteoEnviosArchivo++;
                        }
                    }
                }
                
                int dias = fechasEnEsteArchivo.isEmpty() ? 1 : fechasEnEsteArchivo.size();
                enviosPorOrigen.put(origen, (conteoEnviosArchivo + dias - 1) / dias);
            }
        } catch (IOException e) {
            System.err.println("Error procesando carpetas: " + e.getMessage());
        }

        // 3. REPORTE FINAL DE CARGA REAL
        System.out.println("==================================================");
        System.out.println("   ANÁLISIS DE DEMANDA REAL VS. CAPACIDAD");
        System.out.println("==================================================");
        
        System.out.printf("%-15s | %-15s%n", "FECHA", "TOTAL MALETAS");
        System.out.println("--------------------------------------------------");
        
        long sumaGlobalMaletas = 0;
        for (Map.Entry<String, Long> entry : maletasPorDia.entrySet()) {
            System.out.printf("%-15s | %-15d%n", entry.getKey(), entry.getValue());
            sumaGlobalMaletas += entry.getValue();
        }

        long promedioReal = maletasPorDia.isEmpty() ? 0 : sumaGlobalMaletas / maletasPorDia.size();

        System.out.println("==================================================");
        System.out.println("RESUMEN DE ESTRÉS (Promedio Real: " + promedioReal + ")");
        System.out.println("Capacidad 100%: " + capacidadTotalVuelos + " maletas/día");
        System.out.println("--------------------------------------------------");
        
        mostrarNivel("Nivel 20%", capacidadTotalVuelos * 0.2, promedioReal);
        mostrarNivel("Nivel 40%", capacidadTotalVuelos * 0.4, promedioReal);
        mostrarNivel("Nivel 60%", capacidadTotalVuelos * 0.6, promedioReal);
        mostrarNivel("Nivel 80%", capacidadTotalVuelos * 0.8, promedioReal);
        System.out.println("==================================================");
    }

    private static void mostrarNivel(String nombre, double capNivel, long promedioReal) {
        String estado = (promedioReal > capNivel) ? "[!] SOBRECARGA" : "[OK] FLUIDO";
        System.out.printf("%-10s: %-8.0f maletas -> %s%n", nombre, capNivel, estado);
    }
}