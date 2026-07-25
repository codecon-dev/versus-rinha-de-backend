import { NestFactory } from '@nestjs/core';
import { UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    exceptionFactory: (errors) => new UnprocessableEntityException(errors),
  }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();