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
      host: 'localhost',
      port: 5432,
      username: 'rinha',
      password: 'rinha',
      database: 'rinha',
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
