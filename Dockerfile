FROM node:22-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./
COPY index.html about.html contact.html enquiry.html medicines.html order.html thankyou.html track.html robots.txt sitemap.xml googlebff06d560bec1931.html ./
COPY assets/ ./assets/
COPY css/ ./css/
COPY js/ ./js/

EXPOSE 3000

CMD ["node", "server.js"]
