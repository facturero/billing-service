import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3009),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default('secret'),
  DB_NAME: z.string().default('billing_db'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  ORG_SERVICE_URL: z.string().default('http://organization-service:3002'),
  CUSTOMER_SERVICE_URL: z.string().default('http://customer-service:3004'),
  PRODUCT_SERVICE_URL: z.string().default('http://product-service:3006'),
  TAX_SERVICE_URL: z.string().default('http://tax-service:3005'),

  RABBITMQ_URL: z.string().optional(),

  DOCUMENT_SERVICE_URL: z.string().default('http://document-service:3007'),
  INTERNAL_SERVICE_SECRET: z.string().default('dev-internal-secret-change-me'),

  JWT_PUBLIC_KEY_PATH: z.string().default('certs/public.pem'),
  JWT_ISSUER: z.string().default('cmr-auth'),
  JWT_AUDIENCE: z.string().default('cmr-api'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function loadConfig(): Env {
  if (!_env) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error('Configuración inválida:');
      for (const issue of parsed.error.issues) {
        console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
      }
      process.exit(1);
    }
    _env = parsed.data;
  }
  return _env;
}

export const config = loadConfig();
