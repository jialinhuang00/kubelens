FROM golang:1.23-alpine AS build
ARG VERSION=dev
WORKDIR /src
COPY main.go .
RUN go mod init order-service && CGO_ENABLED=0 go build -ldflags "-X main.version=${VERSION}" -o /order-service main.go

FROM scratch
COPY --from=build /order-service /order-service
EXPOSE 80
ENTRYPOINT ["/order-service"]
