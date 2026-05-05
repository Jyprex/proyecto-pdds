import java.io.*;
import java.nio.file.*;
import java.util.*;

public class DataStresserDiff {

    private static final String CARPETA_ORIGEN = "."; // Aquí están tus archivos de 920k
    private static final String CARPETA_DESTINO = "nuevos_envios_calibrados";
    
    /**
     * REDUCCIÓN DE 37:
     * Si tus archivos actuales tienen +45 y queremos que tengan +8:
     * Cantidad_Actual (X + 45) - 37 = X + 8.
     * 
     * Esto nos dejará en el rango de ~200,000 maletas diarias.
     */
    private static final int DIFERENCIA_RESTAR = 37; 

    private static final List<String> FECHAS_OBJETIVO = Arrays.asList(
        "20290101", "20290102", "20290103", "20290104", "20290105"
    );

    public static void main(String[] args) {
        try {
            Files.createDirectories(Paths.get(CARPETA_DESTINO));
            Path dir = Paths.get(CARPETA_ORIGEN);

            System.out.println(">>> Ajustando carga: Restando " + DIFERENCIA_RESTAR + " maletas para recalibrar a ~200k...");

            try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "_envios_*.txt")) {
                for (Path archivo : stream) {
                    procesarArchivo(archivo);
                }
            }
            System.out.println("\n[OK] Archivos recalibrados en: /" + CARPETA_DESTINO);

        } catch (IOException e) {
            System.err.println("Error: " + e.getMessage());
        }
    }

    private static void procesarArchivo(Path rutaArchivo) {
        File archivoSalida = new File(CARPETA_DESTINO, rutaArchivo.getFileName().toString());

        try (BufferedReader reader = Files.newBufferedReader(rutaArchivo);
             BufferedWriter writer = new BufferedWriter(new FileWriter(archivoSalida))) {

            String linea;
            while ((linea = reader.readLine()) != null) {
                String[] partes = linea.split("-");
                
                if (partes.length >= 6 && FECHAS_OBJETIVO.contains(partes[1])) {
                    try {
                        int cantidadConExceso = Integer.parseInt(partes[5].trim());
                        int nuevaCantidad = cantidadConExceso - DIFERENCIA_RESTAR;

                        // Validación: No podemos tener menos de 1 maleta por envío
                        if (nuevaCantidad < 1) nuevaCantidad = 1;

                        partes[5] = String.format("%03d", nuevaCantidad);
                        linea = String.join("-", partes);
                    } catch (NumberFormatException e) { }
                }
                writer.write(linea);
                writer.newLine();
            }
        } catch (IOException e) {
            System.err.println("Error procesando " + rutaArchivo.getFileName() + ": " + e.getMessage());
        }
    }
}