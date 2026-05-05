import java.io.*;
import java.nio.file.*;
import java.util.*;

public class DataStresser {

    private static final String CARPETA_ORIGEN = "."; 
    private static final String CARPETA_DESTINO = "nuevos_envios";
    
    /**
     * INCREMENTO +45:
     * Con esto, tu pico de ~735k subirá a aprox. 920k - 940k.
     * Esto es perfecto porque:
     * 1. Supera el nivel de prueba del 80% (756k).
     * 2. Obliga al algoritmo a generar 'arrastre' para el día siguiente.
     */
    private static final int INCREMENTO = 45; 

    private static final List<String> FECHAS_OBJETIVO = Arrays.asList(
        "20290101", "20290102", "20290103", "20290104", "20290105"
    );

    public static void main(String[] args) {
        try {
            Files.createDirectories(Paths.get(CARPETA_DESTINO));
            Path dir = Paths.get(CARPETA_ORIGEN);

            System.out.println("Iniciando inyección de carga: +" + INCREMENTO + " maletas por envío...");
            System.out.println("Rango objetivo: 2029-01-01 al 2029-01-05");

            try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "_envios_*.txt")) {
                for (Path archivo : stream) {
                    procesarArchivo(archivo);
                }
            }
            System.out.println("\n[OK] Archivos generados en la carpeta: /" + CARPETA_DESTINO);

        } catch (IOException e) {
            System.err.println("Error de sistema: " + e.getMessage());
        }
    }

    private static void procesarArchivo(Path rutaArchivo) {
        File archivoSalida = new File(CARPETA_DESTINO, rutaArchivo.getFileName().toString());

        try (BufferedReader reader = Files.newBufferedReader(rutaArchivo);
             BufferedWriter writer = new BufferedWriter(new FileWriter(archivoSalida))) {

            String linea;
            while ((linea = reader.readLine()) != null) {
                if (linea.trim().isEmpty()) continue;

                String[] partes = linea.split("-");
                
                // Formato esperado: id-fecha-hh-mm-dest-###-idCliente
                if (partes.length >= 6) {
                    String fecha = partes[1];

                    if (FECHAS_OBJETIVO.contains(fecha)) {
                        try {
                            int cantidadOriginal = Integer.parseInt(partes[5].trim());
                            int nuevaCantidad = cantidadOriginal + INCREMENTO;

                            // El formato de texto ### soporta hasta 999
                            if (nuevaCantidad > 999) nuevaCantidad = 999;

                            // Mantenemos el formato de 3 dígitos (ej: 045)
                            partes[5] = String.format("%03d", nuevaCantidad);
                            
                            linea = String.join("-", partes);
                        } catch (NumberFormatException e) {
                            // Si la columna 5 no es número, pasamos la línea tal cual
                        }
                    }
                }
                writer.write(linea);
                writer.newLine();
            }
        } catch (IOException e) {
            System.err.println("Error procesando " + rutaArchivo.getFileName() + ": " + e.getMessage());
        }
    }
}