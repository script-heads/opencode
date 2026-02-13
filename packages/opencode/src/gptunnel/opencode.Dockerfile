FROM nginx:alpine

# Копируем всю структуру docker-dist
COPY docker-dist/ /usr/share/nginx/html/

# Настройка nginx для корректной отдачи .sh файлов
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    \
    location / { \
        try_files $uri $uri/ =404; \
        autoindex on; \
    } \
    \
    location ~ \.sh$ { \
        default_type text/plain; \
    } \
    \
    location /releases/ { \
        autoindex on; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80