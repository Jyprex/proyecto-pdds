package com.tasfb2b.shared.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
public class SecurityConfig {

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
     * Política CORS: permite que el frontend en localhost:5173 (Vite dev server)
     * realice llamadas fetch() al backend en localhost:8080.
     * En producción, reemplazar "http://localhost:5173" por el dominio real.
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of(
                "http://localhost:5173",
                "http://localhost:5174",
                "http://localhost:5175",
                "http://localhost:3000"
        ));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(false);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
