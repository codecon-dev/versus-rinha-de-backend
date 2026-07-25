import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from './Accounts/accounts.module';
import { ValidaPixModule } from './worker/ValidaPix.module';
import { TransferModule } from './Transfers/transfers.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      // no container o banco é o serviço `db`; DATABASE_URL vem do compose
      url:
        process.env.DATABASE_URL ??
        'postgres://rinha:rinha@localhost:5432/rinha',
      autoLoadEntities: true,
      synchronize: false,
    }),
    AccountsModule,
    ValidaPixModule,
    TransferModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
