package com.tasfb2b.shared.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

@Configuration
public class SecurityConfig {

    @Value("${app.cors.allowed-origins:http://localhost:5173}")
    private String allowedOrigins;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                // 1. Desactivar CSRF (H2 lo necesita; API es stateless)
                .csrf(csrf -> csrf.disable())

                // 2. Permitir iframes (CLAVE para H2 console)
                .headers(headers -> headers
                        .frameOptions(frame -> frame.disable())
                )

                // 3. CORS habilitado con configuración del bean corsConfigurationSource()
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))

                // 4. Permitir acceso sin autenticación
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/h2-console/**").permitAll()
                        .anyRequest().permitAll()
                );

        return http.build();
    }

    /**
     * Política CORS: configurable por properties.
     *
     * - En dev, normalmente se usa el proxy de Vite (/api -> localhost:8080) y CORS no es necesario.
     * - Si se consume el backend directamente desde el navegador, configurar:
     *   app.cors.allowed-origins=http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();

        List<String> origins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(o -> !o.isBlank())
                .toList();

        if (origins.contains("*")) {
            config.setAllowedOriginPatterns(List.of("*"));
        } else {
            config.setAllowedOrigins(origins);
        }

        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(false);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
