FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=""
ARG VITE_COGNITO_USER_CLIENT_ID=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_COGNITO_USER_CLIENT_ID=$VITE_COGNITO_USER_CLIENT_ID

RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
