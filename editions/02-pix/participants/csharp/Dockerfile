FROM mcr.microsoft.com/dotnet/sdk:9.0 AS builder
WORKDIR /src
COPY *.csproj ./
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /out

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=builder /out ./
ENV ASPNETCORE_URLS=http://0.0.0.0:3000
EXPOSE 3000
ENTRYPOINT ["dotnet", "app.dll"]
