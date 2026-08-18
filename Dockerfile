# Utiliser l'image officielle Node.js 20 avec Debian slim
FROM node:20-slim

# Installer Python, pip et les outils de build nécessaires
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    git \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Créer un lien symbolique pour python3 -> python
RUN ln -s /usr/bin/python3 /usr/bin/python

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances Python
COPY requirements.txt .

# Installer les dépendances Python
RUN pip3 install --no-cache-dir -r requirements.txt

# Copier les fichiers de dépendances Node.js
COPY package*.json ./

# Installer les dépendances Node.js
RUN npm install 

# Copier tout le code source
COPY . .

# Créer les dossiers nécessaires
RUN mkdir -p session data temp decrypted

# Exposer le port (défaut: 5000)
EXPOSE 5000

# Variable d'environnement pour Python
ENV PYTHON_PATH=/usr/bin/python3

# Démarrer le bot
CMD ["npm", "start"]