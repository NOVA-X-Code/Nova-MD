FROM quay.io/qasimtech/NOVA-MD:latest

WORKDIR /root/NOVA-MD

RUN git clone https://github.com/NOVA-X-Code/Nova-MD . && \
    npm install

EXPOSE 5000

CMD ["npm", "start"]
