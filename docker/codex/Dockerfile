FROM docker/sandbox-templates:codex

USER root
COPY shared/install-cloudcli.sh /tmp/install-cloudcli.sh
RUN chmod +x /tmp/install-cloudcli.sh && /tmp/install-cloudcli.sh

USER agent
RUN npm install -g @cloudcli-ai/cloudcli && cloudcli --version

COPY --chown=agent:agent shared/start-cloudcli.sh /home/agent/.cloudcli-start.sh
RUN echo '. ~/.cloudcli-start.sh' >> /home/agent/.bashrc
