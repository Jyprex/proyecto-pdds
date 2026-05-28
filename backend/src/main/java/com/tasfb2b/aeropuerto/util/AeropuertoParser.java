package com.tasfb2b.aeropuerto.util;

import com.tasfb2b.aeropuerto.domain.Continente;

public class AeropuertoParser {

    public static ParsedAeropuerto parse(String line) {
        String trimmed = line.trim();

        if (trimmed.isEmpty() || trimmed.startsWith("*") || trimmed.startsWith("PDDS")) {
            return null;
        }

        // Captura todos los campos incluyendo latitud y longitud completas
        java.util.regex.Pattern p = java.util.regex.Pattern.compile(
                "^(\\d+)\\s+([A-Z]{4})\\s+(.+?)\\s+([a-z]{4})\\s+([+-]?\\d+)\\s+(\\d+)\\s+" +
                        "Latitude:\\s*(\\d+)°\\s*(\\d+)'\\s*(\\d+)\"\\s*([NS])\\s+" +
                        "Longitude:\\s*(\\d+)°\\s*(\\d+)'\\s*(\\d+)\"\\s*([EW])"
        );

        java.util.regex.Matcher m = p.matcher(trimmed);
        if (!m.find()) return null;

        try {
            String icao        = m.group(2);
            String ciudadYPais = m.group(3).trim();
            int gmtOffset      = Integer.parseInt(m.group(5));
            int capacidad      = Integer.parseInt(m.group(6));

            // Latitud
            int latG = Integer.parseInt(m.group(7));
            int latM = Integer.parseInt(m.group(8));
            int latS = Integer.parseInt(m.group(9));
            String latDir = m.group(10); // N o S
            double latitud = (latG + latM / 60.0 + latS / 3600.0) * (latDir.equals("S") ? -1 : 1);

            // Longitud
            int lonG = Integer.parseInt(m.group(11));
            int lonM = Integer.parseInt(m.group(12));
            int lonS = Integer.parseInt(m.group(13));
            String lonDir = m.group(14); // E o W
            double longitud = (lonG + lonM / 60.0 + lonS / 3600.0) * (lonDir.equals("W") ? -1 : 1);

            // Separar ciudad y país
            String[] partes = ciudadYPais.split("\\s+");
            String ultimoToken    = partes[partes.length - 1];
            String penultimoToken = partes.length > 1 ? partes[partes.length - 2] : "";

            boolean paisMultipalabra = ultimoToken.contains(".")
                    || ultimoToken.length() <= 2
                    || ultimoToken.equalsIgnoreCase("Saudita");

            String pais, ciudad;
            if (paisMultipalabra && partes.length >= 2) {
                pais   = penultimoToken + " " + ultimoToken;
                ciudad = String.join(" ", java.util.Arrays.copyOfRange(partes, 0, partes.length - 2));
            } else {
                pais   = ultimoToken;
                ciudad = String.join(" ", java.util.Arrays.copyOfRange(partes, 0, partes.length - 1));
            }

            return new ParsedAeropuerto(icao, ciudad, pais, gmtOffset, capacidad, latitud, longitud);

        } catch (Exception e) {
            System.err.println("Línea ignorada: " + line + " → " + e.getMessage());
            return null;
        }
    }
}
