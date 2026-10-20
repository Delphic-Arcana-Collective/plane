/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { create } from "axios";
import { delphicAuthorizationHeader, isOwnApiRequest, redirectToDelphicAuth } from "@/lib/delphic-auth";

export abstract class APIService {
  protected baseURL: string;
  private axiosInstance: AxiosInstance;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.axiosInstance = create({
      baseURL,
      withCredentials: true,
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    this.axiosInstance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      if (!isOwnApiRequest(config.url, config.baseURL, this.baseURL)) return config;

      const header = delphicAuthorizationHeader();
      if (!header) {
        redirectToDelphicAuth();
        return config;
      }

      config.headers.Authorization = header;
      return config;
    });

    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        if (response.status === 401 && isOwnApiRequest(response.config.url, response.config.baseURL, this.baseURL)) {
          redirectToDelphicAuth();
        }
        return response;
      },
      (error: AxiosError) => {
        if (error.response?.status === 401 && isOwnApiRequest(error.config?.url, error.config?.baseURL, this.baseURL)) {
          redirectToDelphicAuth();
        }
        return Promise.reject(error);
      }
    );
  }

  get(url: string, params = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.get(url, {
      ...params,
      ...config,
    });
  }

  post(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.post(url, data, config);
  }

  put(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.put(url, data, config);
  }

  patch(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.patch(url, data, config);
  }

  delete(url: string, data?: any, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.delete(url, { data, ...config });
  }

  request(config = {}) {
    return this.axiosInstance(config);
  }
}
