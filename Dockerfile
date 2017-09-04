FROM node:7.6-alpine
MAINTAINER Ryan Gaus "rgaus.net"

# Python id required for building node-sass because node-sass uses node-gyp, which needs python.
RUN apk add --update python build-base 

# Create a user to run the app and setup a place to put the app
COPY . /app
RUN rm -rf /app/node_modules

WORKDIR /app

# Set up packages
RUN yarn

# Run the app
CMD yarn start
