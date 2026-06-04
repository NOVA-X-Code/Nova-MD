FROM quay.io/qasimtech/NOVA-MD:latest

WORKDIR /root/NOVA-MD

COPY package.json package-lock.json ./

RUN npm install

COPY . .

EXPOSE 5000

CMD ["npm", "run", "start:optimized"]
